import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService.sendPasswordResetCode', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.NODE_ENV;
  const fetchMock = jest.fn();

  const serviceWith = (env: Record<string, string | undefined>) =>
    new MailService({ get: (key: string) => env[key] } as unknown as ConfigService);

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('envía el código a Resend con la clave en la cabecera', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const service = serviceWith({ RESEND_API_KEY: 're_test', RESEND_FROM: 'Room8 <no-reply@room8.app>' });

    await expect(service.sendPasswordResetCode('ana@ejemplo.com', '123456', 15)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Room8 <no-reply@room8.app>');
    expect(body.to).toEqual(['ana@ejemplo.com']);
    expect(body.text).toContain('123456');
    expect(body.text).toContain('15 minutos');
    expect(body.html).toContain('123456');
  });

  it('sin RESEND_FROM usa el remitente de pruebas de Resend', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await serviceWith({ RESEND_API_KEY: 're_test' }).sendPasswordResetCode('a@b.com', '123456', 15);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe('Room8 <onboarding@resend.dev>');
  });

  it('sin clave en desarrollo no llama a Resend y escribe el código en la consola', async () => {
    process.env.NODE_ENV = 'development';
    const warn = jest.spyOn(Logger.prototype, 'warn');

    await expect(
      serviceWith({}).sendPasswordResetCode('ana@ejemplo.com', '654321', 15),
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('654321');
  });

  it('sin clave en producción no escribe el código en ningún log', async () => {
    process.env.NODE_ENV = 'production';
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const error = jest.spyOn(Logger.prototype, 'error');

    await expect(serviceWith({}).sendPasswordResetCode('a@b.com', '654321', 15)).resolves.toBe(false);

    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain('654321');
    expect(error).toHaveBeenCalled();
  });

  it('si Resend responde con error devuelve false sin lanzar y sin filtrar la clave', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const error = jest.spyOn(Logger.prototype, 'error');

    await expect(
      serviceWith({ RESEND_API_KEY: 're_secreta' }).sendPasswordResetCode('a@b.com', '123456', 15),
    ).resolves.toBe(false);

    expect(JSON.stringify(error.mock.calls)).not.toContain('re_secreta');
  });

  it('si no hay conexión devuelve false sin lanzar', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(
      serviceWith({ RESEND_API_KEY: 're_test' }).sendPasswordResetCode('a@b.com', '123456', 15),
    ).resolves.toBe(false);
  });
});
