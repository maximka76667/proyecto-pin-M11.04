import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { SegmentedControl } from '@/components/onboarding';
import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, apiMultipart, errorMessage, type UploadFile } from '@/lib/api';
import {
  ACCEPTED_MIME_TYPES,
  FILE_NOT_ACCEPTED,
  FILE_TOO_BIG,
  LINK_NOT_ACCEPTED,
  MAX_DOCUMENT_BYTES,
  documentIcon,
  formatDate,
  formatSize,
  isGoogleLink,
  type ApartmentDocument,
  type DocumentAccess,
} from '@/lib/documents';

type Source = 'file' | 'link';

export default function Documents() {
  const [docs, setDocs] = useState<ApartmentDocument[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<ApartmentDocument | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<ApartmentDocument | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await api('GET', `/documents?apartment_id=${APARTMENT_ID}`));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/profile' as Href));

  const open = async (doc: ApartmentDocument) => {
    // En la web el navegador bloquea las pestañas que se abren tras una petición asíncrona:
    // se abre una en blanco ya, dentro del toque, y se rellena cuando llega el enlace
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    try {
      const access: DocumentAccess = await api('GET', `/documents/${doc.id}/access`);
      if (Platform.OS === 'web') {
        if (tab) tab.location.replace(access.url);
        else window.location.assign(access.url);
      } else {
        await WebBrowser.openBrowserAsync(access.url);
      }
    } catch (e) {
      tab?.close();
      setNotice(errorMessage(e));
    }
  };

  const confirmDelete = async () => {
    const doc = toDelete;
    setToDelete(null);
    if (!doc) return;
    try {
      await api('DELETE', `/documents/${doc.id}`);
      setNotice('Documento borrado');
      await load();
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={goBack} hitSlop={12} accessibilityLabel="Volver">
            <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
          </Pressable>
          <Text style={styles.title}>Documentos de la casa</Text>
          <Pressable
            onPress={() => setEditing('new')}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Añadir documento">
            <MaterialCommunityIcons name="plus" size={18} color={Palette.onPrimary} />
            <Text style={styles.addText}>Añadir</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          Los ven y pueden editarlos todos los de la casa. PDF, JPG, PNG o enlaces de Google.
        </Text>

        {docs === null && !error ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? (
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.error}>{error} · Toca para reintentar</Text>
          </Pressable>
        ) : null}
        {docs?.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="folder-open-outline"
              size={40}
              color={Palette.textSecondary}
            />
            <Text style={styles.emptyText}>
              Aún no hay documentos. Sube el contrato, las facturas o las normas de la casa.
            </Text>
          </View>
        ) : null}

        {docs?.map((doc) => (
          <View key={doc.id} style={styles.card}>
            <Pressable
              style={styles.cardMain}
              onPress={() => void open(doc)}
              accessibilityRole="button"
              accessibilityLabel={`Abrir ${doc.name}`}>
              <View style={styles.iconBox}>
                <MaterialCommunityIcons
                  name={documentIcon(doc)}
                  size={24}
                  color={Palette.primary}
                />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {doc.name}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={2}>
                  {[
                    doc.creator ? `Subido por ${doc.creator.full_name}` : 'Subido',
                    formatDate(doc.created_at),
                    doc.kind === 'link' ? 'Enlace de Google' : formatSize(doc.size_bytes),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setEditing(doc)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Editar ${doc.name}`}>
              <MaterialCommunityIcons
                name="pencil-outline"
                size={21}
                color={Palette.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => setToDelete(doc)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Borrar ${doc.name}`}>
              <MaterialCommunityIcons name="trash-can-outline" size={21} color={Palette.error} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      {editing ? (
        <DocumentForm
          doc={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}

      <ConfirmDialog
        visible={toDelete !== null}
        title="¿Borrar documento?"
        message={`«${toDelete?.name ?? ''}» desaparecerá para todos los de la casa.`}
        confirmLabel="Borrar"
        icon="trash-can-outline"
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
      <Snackbar visible={notice !== ''} onDismiss={() => setNotice('')} duration={3500}>
        {notice}
      </Snackbar>
    </SafeAreaView>
  );
}

function DocumentForm({
  doc,
  onClose,
  onSaved,
}: {
  doc: ApartmentDocument | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(doc?.name ?? '');
  const [source, setSource] = useState<Source>(doc?.kind ?? 'file');
  const [picked, setPicked] = useState<UploadFile | null>(null);
  const [link, setLink] = useState(doc?.kind === 'link' ? (doc.url ?? '') : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED_MIME_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    // Avisar aquí ahorra subir 10 MB para que el servidor lo rechace; el servidor vuelve a comprobarlo
    const type = asset.mimeType ?? '';
    if (!ACCEPTED_MIME_TYPES.includes(type)) {
      setError(FILE_NOT_ACCEPTED);
      return;
    }
    if (asset.size !== undefined && asset.size > MAX_DOCUMENT_BYTES) {
      setError(FILE_TOO_BIG);
      return;
    }
    setError('');
    setPicked({ uri: asset.uri, name: asset.name, type, file: asset.file });
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Ponle un nombre al documento');
    if (trimmed.length > 80) return setError('El nombre no puede superar los 80 caracteres');

    const isNew = doc === null;
    // Al editar, solo se manda archivo/enlace si se ha cambiado
    const changesLink = source === 'link' && (isNew || link.trim() !== (doc?.url ?? ''));
    if (source === 'file' && (isNew || doc?.kind === 'link') && !picked) {
      return setError('Elige un archivo');
    }
    if (source === 'link' && changesLink && !isGoogleLink(link)) {
      return setError(LINK_NOT_ACCEPTED);
    }

    setSaving(true);
    setError('');
    try {
      const fields: Record<string, string | undefined> = { name: trimmed };
      if (isNew) fields.apartment_id = APARTMENT_ID;
      if (source === 'link' && changesLink) fields.url = link.trim();
      const upload = source === 'file' && picked ? { field: 'file', file: picked } : undefined;

      if (isNew) await apiMultipart('POST', '/documents', fields, upload);
      else await apiMultipart('PATCH', `/documents/${doc.id}`, fields, upload);
      onSaved(isNew ? 'Documento añadido' : 'Documento actualizado');
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{doc ? 'Editar documento' : 'Nuevo documento'}</Text>

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder="Contrato de alquiler"
            placeholderTextColor={Palette.textSecondary}
            style={styles.input}
          />

          <SegmentedControl<Source>
            options={[
              { value: 'file', label: 'Archivo' },
              { value: 'link', label: 'Enlace de Google' },
            ]}
            value={source}
            onChange={(value) => {
              setSource(value);
              setError('');
            }}
          />

          {source === 'file' ? (
            <View style={styles.block}>
              <Pressable
                onPress={() => void pick()}
                style={styles.pickButton}
                accessibilityRole="button">
                <MaterialCommunityIcons name="paperclip" size={20} color={Palette.primary} />
                <Text style={styles.pickText} numberOfLines={1}>
                  {picked
                    ? picked.name
                    : doc?.kind === 'file'
                      ? 'Cambiar archivo (opcional)'
                      : 'Elegir PDF, JPG, PNG o WebP'}
                </Text>
              </Pressable>
              <Text style={styles.small}>Máximo 10 MB.</Text>
            </View>
          ) : (
            <View style={styles.block}>
              <TextInput
                value={link}
                onChangeText={setLink}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://docs.google.com/…"
                placeholderTextColor={Palette.textSecondary}
                style={styles.input}
              />
              <Text style={styles.small}>
                Comparte el documento en Google con tus compañeros (acceso a «cualquiera con el
                enlace» o a sus cuentas), si no, no podrán abrirlo.
              </Text>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              style={[styles.save, saving && { opacity: 0.6 }]}
              accessibilityRole="button">
              {saving ? (
                <ActivityIndicator color={Palette.onPrimary} />
              ) : (
                <Text style={styles.saveText}>Guardar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: { padding: 20, gap: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: Palette.text },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.primary,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addText: { color: Palette.onPrimary, fontWeight: '600' },
  hint: { color: Palette.textSecondary, fontSize: 13 },
  error: { color: Palette.error, fontSize: 13 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { color: Palette.textSecondary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Palette.surface,
    borderColor: Palette.border,
    borderWidth: 1,
    borderRadius: Radius.button,
    padding: 12,
  },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Palette.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Palette.text },
  cardMeta: { fontSize: 12, color: Palette.textSecondary },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Palette.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  label: { fontSize: 13, fontWeight: '600', color: Palette.text },
  input: {
    backgroundColor: Palette.surface,
    borderColor: Palette.border,
    borderWidth: 1,
    borderRadius: Radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Palette.text,
  },
  block: { gap: 8 },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderColor: Palette.primary,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: Radius.input,
    padding: 14,
  },
  pickText: { flex: 1, color: Palette.primary, fontWeight: '600' },
  small: { fontSize: 12, color: Palette.textSecondary },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancel: {
    flex: 1,
    alignItems: 'center',
    padding: 14,
    borderRadius: Radius.button,
    backgroundColor: Palette.segment,
  },
  cancelText: { color: Palette.text, fontWeight: '600' },
  save: {
    flex: 1,
    alignItems: 'center',
    padding: 14,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  saveText: { color: Palette.onPrimary, fontWeight: '600' },
});
