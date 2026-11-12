import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { Eyebrow, Field, PrimaryButton, SegmentedControl } from '@/components/onboarding';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage, setAuthToken } from '@/lib/api';
import { PASSWORD_HINT, PASSWORD_MESSAGES, validateEmail, validateNewPassword } from '@/lib/password-policy';

type Mode = 'login' | 'register';
type AuthField = 'name' | 'email' | 'password';
type AuthErrors = Partial<Record<AuthField, string>>;

// PA-1014.05: se valida antes de enviar para no llamar a la API con datos que va a rechazar.
// En el login la contraseña solo es obligatoria, para no dejar fuera contraseñas antiguas
function validateAuthForm(mode: Mode, values: { name: string; email: string; password: string }) {
  const errors: AuthErrors = {};
  if (mode === 'register' && !values.name.trim()) errors.name = PASSWORD_MESSAGES.required;
  const emailError = validateEmail(values.email);
  if (emailError) errors.email = emailError;
  const passwordError =
    mode === 'register' ? validateNewPassword(values.password) : !values.password ? PASSWORD_MESSAGES.required : undefined;
  if (passwordError) errors.password = passwordError;
  return errors;
}

export default function Auth() {
  const params = useLocalSearchParams<{
    token?: string;
    google_error?: string;
    expired?: string;
    reset?: string;
    verified?: string;
  }>();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthErrors>({});
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);

  // Al escribir en un campo desaparece su error
  const edit = (field: AuthField, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (fieldErrors[field]) setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  useEffect(() => {
    if (params.token) {
      setAuthToken(params.token);
      router.replace(params.verified ? { pathname: '/', params: { verified: '1' } } : '/');
    } else if (params.google_error) {
      setError('No se pudo conectar con Google.');
    }
  }, [params.google_error, params.token]);

  const submit = async () => {
    const errors = validateAuthForm(mode, { name, email, password });
    setFieldErrors(errors);
    setError('');
    if (Object.values(errors).some(Boolean)) return;
    setLoading(true);
    try {
      const result = await api('POST', `/auth/${mode}`, {
        email: email.trim(),
        password,
        ...(mode === 'register' ? { full_name: name.trim() } : {}),
      });
      if (mode === 'register') {
        setVerificationPending(true);
      } else {
        setAuthToken(result.token);
        router.replace('/');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const callbackUri = Linking.createURL('auth/google/callback');
      const result = await api(
        'GET',
        `/auth/google/start?callback_uri=${encodeURIComponent(
          Platform.OS === 'web' ? `${window.location.origin}/auth` : callbackUri,
        )}`,
      );
      if (Platform.OS === 'web') {
        window.location.assign(result.url);
      } else {
        const browserResult = await WebBrowser.openAuthSessionAsync(result.url, callbackUri);
        if (browserResult.type !== 'success') {
          setError('La conexión con Google se ha cancelado.');
          return;
        }
        const returnedUrl = new URL(browserResult.url);
        const token = returnedUrl.searchParams.get('token');
        if (!token) {
          setError('Google no devolvió una sesión válida.');
          return;
        }
        setAuthToken(token);
        router.replace('/');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}><View style={styles.logo}><Text style={styles.logoText}>8</Text></View><Text style={styles.brandText}>room8</Text></View>
        <View style={styles.header}>
          <Eyebrow>Tu hogar, en buenas manos</Eyebrow>
          <Text style={styles.title}>{mode === 'login' ? 'Bienvenido de nuevo.' : 'Crea tu cuenta.'}</Text>
          <Text style={styles.subtitle}>Organiza tu casa de forma sencilla, justa y compartida.</Text>
        </View>
        {verificationPending ? (
          <View style={[styles.notice, styles.noticeSuccess]} accessibilityLiveRegion="polite">
            <MaterialCommunityIcons name="email-check-outline" size={20} color={Palette.primary} />
            <Text style={[styles.noticeText, { color: Palette.primary }]}>
              Confirma tu email. Te hemos enviado un enlace a {email}. Después podrás iniciar sesión.
            </Text>
          </View>
        ) : null}
        {/* PA-1015.02: llega aquí cuando el backend rechaza el token (p. ej. contraseña cambiada en otro dispositivo) */}
        {params.expired ? (
          <View style={[styles.notice, styles.noticeWarning]} accessibilityLiveRegion="polite">
            <MaterialCommunityIcons name="clock-alert-outline" size={20} color={Palette.error} />
            <Text style={[styles.noticeText, { color: Palette.error }]}>Tu sesión ha caducado. Vuelve a iniciar sesión</Text>
          </View>
        ) : null}
        {params.reset ? (
          <View style={[styles.notice, styles.noticeSuccess]} accessibilityLiveRegion="polite">
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={Palette.primary} />
            <Text style={[styles.noticeText, { color: Palette.primary }]}>Contraseña restablecida. Inicia sesión con tu nueva contraseña.</Text>
          </View>
        ) : null}
        {params.verified ? (
          <View style={[styles.notice, styles.noticeSuccess]} accessibilityLiveRegion="polite">
            <MaterialCommunityIcons name="email-check-outline" size={20} color={Palette.primary} />
            <Text style={[styles.noticeText, { color: Palette.primary }]}>
              Email verificado correctamente. Ya puedes entrar en Room8.
            </Text>
          </View>
        ) : null}
        {!verificationPending ? <SegmentedControl options={[{ value: 'login', label: 'Iniciar sesión' }, { value: 'register', label: 'Registrarme' }]} value={mode} onChange={(value) => { setMode(value); setError(''); setFieldErrors({}); }} /> : null}
        {!verificationPending ? (
          <>
            <View style={styles.form}>
              {mode === 'register' ? (
                <View style={styles.field}>
                  <Field label="Tu nombre" placeholder="p. ej. Alex" value={name} onChangeText={edit('name', setName)} />
                  <FieldMessage error={fieldErrors.name} />
                </View>
              ) : null}
              <View style={styles.field}>
                <Field label="Email" placeholder="tu@email.com" value={email} onChangeText={edit('email', setEmail)} keyboardType="email-address" autoCapitalize="none" />
                <FieldMessage error={fieldErrors.email} />
              </View>
              <View style={styles.field}>
                <Field label="Contraseña" placeholder="Mínimo 8 caracteres" value={password} onChangeText={edit('password', setPassword)} secureTextEntry />
                <FieldMessage error={fieldErrors.password} hint={mode === 'register' ? PASSWORD_HINT : undefined} />
              </View>
              {mode === 'login' ? (
                <Pressable onPress={() => router.push('/forgot-password' as Href)} disabled={loading} hitSlop={8} accessibilityRole="link" style={styles.forgot}>
                  <Text style={styles.forgotText}>¿Has olvidado tu contraseña?</Text>
                </Pressable>
              ) : null}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton title={mode === 'login' ? 'Entrar' : 'Crear cuenta'} onPress={submit} loading={loading} />
            <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>o</Text><View style={styles.line} /></View>
            <Pressable style={styles.google} onPress={googleLogin} disabled={loading}>
              <MaterialCommunityIcons name="google" size={20} color={Palette.text} />
              <Text style={styles.googleText}>Continuar con Google</Text>
            </Pressable>
          </>
        ) : null}
        <Text style={styles.footer}>Al continuar aceptas usar Room8 para gestionar tu hogar.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// Error (o ayuda) justo debajo de su campo, con el mismo estilo que FieldShell de password-field.tsx
function FieldMessage({ error, hint }: { error?: string; hint?: string }) {
  if (error) {
    return (
      <Text style={styles.fieldError} accessibilityLiveRegion="polite">
        {error}
      </Text>
    );
  }
  return hint ? <Text style={styles.fieldHint}>{hint}</Text> : null;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center', padding: 24, gap: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  logo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.peach },
  logoText: { fontSize: 18, fontWeight: '800', color: Palette.text },
  brandText: { fontSize: 20, fontWeight: '800', color: Palette.text },
  header: { gap: 8 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 15, lineHeight: 22, color: Palette.textSecondary },
  form: { gap: 16 },
  field: { gap: 6 },
  fieldError: { fontSize: 13, lineHeight: 18, color: Palette.error },
  fieldHint: { fontSize: 13, lineHeight: 18, color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: Palette.border },
  or: { color: Palette.textSecondary },
  google: { height: 52, borderRadius: Radius.button, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  googleText: { fontSize: 15, fontWeight: '700', color: Palette.text },
  footer: { fontSize: 12, textAlign: 'center', color: Palette.textSecondary },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: Radius.input },
  noticeWarning: { backgroundColor: '#FBE9E7' },
  noticeSuccess: { backgroundColor: Palette.mint },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  forgot: { alignSelf: 'flex-end' },
  forgotText: { fontSize: 14, fontWeight: '700', color: Palette.primary },
});
