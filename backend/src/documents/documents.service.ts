import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto, UpdateDocumentDto } from './dto/document.dto';
import {
  DOCUMENTO_MUY_GRANDE,
  DOCUMENTO_NO_VALIDO,
  EXTENSION_DE,
  MAX_DOCUMENTOS_POR_PISO,
  PESO_MAXIMO_DOCUMENTO,
  tipoDeDocumento,
} from './document-file';
import { DocumentsStorageService } from './documents-storage.service';
import { enlaceDeGoogle } from './google-link';
 
// Segundos que dura el enlace con el que se abre un archivo
export const SEGUNDOS_DE_ENLACE = 300;
 
// Lo que ve la app. No incluye storage_path: la ruta interna del archivo no sale del servidor
const VISIBLE = {
  id: true,
  apartment_id: true,
  name: true,
  kind: true,
  mime_type: true,
  size_bytes: true,
  original_filename: true,
  url: true,
  created_at: true,
  updated_at: true,
  creator: { select: { id: true, full_name: true } },
  editor: { select: { id: true, full_name: true } },
} satisfies Prisma.ApartmentDocumentSelect;
 
type Archivo = Express.Multer.File | undefined;
 
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
 
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentsStorageService,
  ) {}
 
  // Todos los documentos del piso, para cualquiera de sus miembros
  async list(apartmentId: string, userId: string) {
    await this.assertMember(apartmentId, userId);
    return this.prisma.apartmentDocument.findMany({
      where: { apartment_id: apartmentId },
      select: VISIBLE,
      orderBy: { created_at: 'desc' },
    });
  }
 
  // Un documento es un archivo (PDF/JPG/PNG/WebP) o un enlace de Google, con el nombre que
  // le ponga quien lo sube. Cualquier miembro del piso puede subirlo
  async create(userId: string, dto: CreateDocumentDto, file: Archivo) {
    await this.assertMember(dto.apartment_id, userId);
    const link = this.checkedLink(dto.url);
    if (file && link) {
      throw new BadRequestException('Sube un archivo o pega un enlace, no las dos cosas');
    }
    if (!file && !link) {
      throw new BadRequestException('Elige un archivo o pega un enlace de Google');
    }
 
    const total = await this.prisma.apartmentDocument.count({
      where: { apartment_id: dto.apartment_id },
    });
    if (total >= MAX_DOCUMENTOS_POR_PISO) {
      throw new ConflictException(
        `El piso ya tiene ${MAX_DOCUMENTOS_POR_PISO} documentos: borra alguno para añadir más`,
      );
    }
 
    const base = {
      apartment_id: dto.apartment_id,
      name: dto.name,
      created_by: userId,
      updated_by: userId,
    };
 
    if (link) {
      return this.prisma.apartmentDocument.create({
        data: { ...base, kind: 'link' as const, url: link },
        select: VISIBLE,
      });
    }
 
    const stored = this.checkedFile(dto.apartment_id, file);
    await this.storage.upload(stored.path, stored.content, stored.mime);
    try {
      return await this.prisma.apartmentDocument.create({
        data: { ...base, ...this.fileColumns(stored) },
        select: VISIBLE,
      });
    } catch (error) {
      // Sin fila en la base de datos el archivo quedaría huérfano en Storage
      await this.storage.remove(stored.path).catch(() => undefined);
      throw error;
    }
  }
 
  // Cambiar el nombre y/o el archivo o enlace. No importa quién lo subió: cualquier miembro
  async update(id: string, userId: string, dto: UpdateDocumentDto, file: Archivo) {
    const doc = await this.load(id);
    await this.assertMember(doc.apartment_id, userId);
 
    const link = this.checkedLink(dto.url);
    if (file && link) {
      throw new BadRequestException('Sube un archivo o pega un enlace, no las dos cosas');
    }
    if (dto.name === undefined && !file && !link) {
      throw new BadRequestException('No hay nada que cambiar');
    }
 
    const data: Prisma.ApartmentDocumentUncheckedUpdateInput = { updated_by: userId };
    if (dto.name !== undefined) data.name = dto.name;
 
    let newPath: string | null = null;
    if (link) {
      Object.assign(data, this.linkColumns(link));
    } else if (file) {
      const stored = this.checkedFile(doc.apartment_id, file);
      // Primero se sube el nuevo (con otra ruta) y solo al final se borra el viejo: si algo
      // falla por el camino, el documento sigue teniendo su archivo anterior
      await this.storage.upload(stored.path, stored.content, stored.mime);
      newPath = stored.path;
      Object.assign(data, this.fileColumns(stored));
    }
 
    let updated;
    try {
      updated = await this.prisma.apartmentDocument.update({
        where: { id },
        data,
        select: VISIBLE,
      });
    } catch (error) {
      if (newPath) await this.storage.remove(newPath).catch(() => undefined);
      throw error;
    }
 
    if ((file || link) && doc.storage_path) {
      await this.removeQuietly(doc.storage_path);
    }
    return updated;
  }
 
  async remove(id: string, userId: string) {
    const doc = await this.load(id);
    await this.assertMember(doc.apartment_id, userId);
 
    await this.prisma.apartmentDocument.delete({ where: { id } });
    if (doc.storage_path) await this.removeQuietly(doc.storage_path);
    return { deleted: true };
  }
 
  // Dirección con la que abrir el documento: el enlace de Google tal cual, o un enlace
  // temporal (5 minutos) al archivo del bucket privado
  async access(id: string, userId: string) {
    const doc = await this.load(id);
    await this.assertMember(doc.apartment_id, userId);
 
    if (doc.kind === 'link' && doc.url) {
      return { kind: 'link', url: doc.url, name: doc.name };
    }
    if (!doc.storage_path) {
      throw new NotFoundException('Este documento no tiene archivo');
    }
    return {
      kind: 'file',
      url: await this.storage.signedUrl(doc.storage_path, SEGUNDOS_DE_ENLACE),
      name: doc.name,
      mime_type: doc.mime_type,
    };
  }
 
  private async load(id: string) {
    const doc = await this.prisma.apartmentDocument.findUnique({
      where: { id },
      select: {
        id: true,
        apartment_id: true,
        name: true,
        kind: true,
        url: true,
        storage_path: true,
        mime_type: true,
      },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return doc;
  }
 
  // Cualquier miembro del piso, y solo de su piso
  private async assertMember(apartmentId: string, userId: string) {
    const member = await this.prisma.userApartment.findUnique({
      where: { user_id_apartment_id: { user_id: userId, apartment_id: apartmentId } },
      select: { user_id: true },
    });
    if (!member) throw new ForbiddenException('No perteneces a este piso');
  }
 
  private checkedLink(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const link = enlaceDeGoogle(value);
    if (!link) {
      throw new BadRequestException(
        'El enlace debe ser de Google Docs, Sheets, Slides o Drive (https://docs.google.com/…)',
      );
    }
    return link;
  }
 
  // Comprueba tamaño y formato REAL del archivo y decide su ruta en Storage. La ruta se
  // genera aquí (nunca sale del nombre que pone el usuario)
  private checkedFile(apartmentId: string, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Falta el archivo');
    if (file.size > PESO_MAXIMO_DOCUMENTO) {
      throw new BadRequestException(DOCUMENTO_MUY_GRANDE);
    }
    const mime = tipoDeDocumento(file.buffer);
    if (!mime) throw new BadRequestException(DOCUMENTO_NO_VALIDO);
 
    return {
      path: `${apartmentId}/${randomUUID()}.${EXTENSION_DE[mime]}`,
      mime,
      content: file.buffer,
      size: file.size,
      originalName: (file.originalname ?? '').slice(0, 120) || null,
    };
  }
 
  private fileColumns(stored: ReturnType<DocumentsService['checkedFile']>) {
    return {
      kind: 'file' as const,
      storage_path: stored.path,
      mime_type: stored.mime,
      size_bytes: stored.size,
      original_filename: stored.originalName,
      url: null,
    };
  }
 
  private linkColumns(link: string) {
    return {
      kind: 'link' as const,
      url: link,
      storage_path: null,
      mime_type: null,
      size_bytes: null,
      original_filename: null,
    };
  }
 
  // Borrar el archivo viejo no debe hacer fallar una operación que ya salió bien
  private async removeQuietly(path: string) {
    try {
      await this.storage.remove(path);
    } catch (error) {
      this.logger.warn(`No se pudo borrar ${path} de Storage: ${String(error)}`);
    }
  }
}
 
