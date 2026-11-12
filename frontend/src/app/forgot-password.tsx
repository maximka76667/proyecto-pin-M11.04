import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { CodeField, EmailField, PasswordField } from '@/components/password-field';
import { PasswordScreen } from '@/components/password-screen';
import { Palette } from '@/constants/onboarding';
import { api } from '@/lib/api';
import {
  describeApiError,
  hasErrors,
  PASSWORD_HINT,
  validateEmail,
  validatePasswordReset,
  type FieldErrors,
  type PasswordField as Field,
} from '@/lib/password-policy';

const RESEND_SECONDS = 60;

type Step = 'email' | 'reset';

// "¿Has olvidado tu contraseña?" desde el login. Sin la contraseña actual, el usuario
// demuestra que el email es suyo con un código de 8 dígitos que le llega allí.
// Paso 1: pedir el código. Paso 2: la misma interfaz que "Cambiar contraseña",
// con el código en lugar de la contraseña actual.
export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Cuenta atrás para poder pedir otro código
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const toLogin = () => router.replace('/auth' as Href);

  const requestCode = async () => {
    if (loading) return;
    const error = validateEmail(email);
    setEmailError(error);
    setGeneralError('');
    if (error) return;

    setLoading(true);
    try {
      // La respuesta es la misma exista o no la cuenta: la app no sabe si hay email
      await api('POST', '/auth/forgot-password', { email: email.trim().toLowerCase() });
      setStep('reset');
      setSecondsLeft(RESEND_SECONDS);
    } catch (e) {
      setGeneralError(
        describeApiError(e, 'No se ha podido enviar el código. Inténtalo más tarde.').general ?? '',
      );
    } finally {
      setLoading(false);
    }
  };

  const edit = (field: Field, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined }));
    if (generalError) setGeneralError('');
  };

  const resetPassword = async () => {
    if (loading) return;
    const localErrors = validatePasswordReset({ code, next, confirm });
    setErrors(localErrors);
    setGeneralError('');
    if (hasErrors(localErrors)) return;

    setLoading(true);
    try {
      await api('POST', '/auth/reset-password', {
        email: email.trim().toLowerCase(),
        code,
        new_password: next,
        confirm_password: confirm,
      });
      setCode('');
      setNext('');
      setConfirm('');
      // Restablecer cierra todas las sesiones: se vuelve a entrar con la nueva contraseña
      router.replace({ pathname: '/auth', params: { reset: '1' } } as Href);
    } catch (e) {
      const { fields, general } = describeApiError(
        e,
        'No se ha podido cambiar la contraseña. Inténtalo más tarde.',
      );
      setErrors(fields);
      setGeneralError(general ?? '');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'email') {
    return (
      <PasswordScreen
        backLabel="Iniciar sesión"
        onBack={toLogin}
        title="¿Has olvidado tu contraseña?"
        subtitle="Escribe el email de tu cuenta y te enviaremos un código para crear una nueva."
        tip="Por seguridad, el código caduca a los 15 minutos y solo sirve una vez."
        error={generalError}
        submitLabel="Enviar código"
        onSubmit={requestCode}
        loading={loading}
        onCancel={toLogin}>
        <EmailField
          label="Email"
          placeholder="tu@email.com"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (emailError) setEmailError(undefined);
          }}
          error={emailError}
          editable={!loading}
          returnKeyType="send"
          onSubmitEditing={requestCode}
        />
      </PasswordScreen>
    );
  }

  return (
    <PasswordScreen
      backLabel="Cambiar email"
      onBack={() => {
        setStep('email');
        setErrors({});
        setGeneralError('');
      }}
      title="Cambiar contraseña"
      subtitle={`Si ${email.trim()} tiene una cuenta, te hemos enviado un código de 8 dígitos. Escríbelo y elige tu nueva contraseña.`}
      error={generalError}
      submitLabel="Guardar contraseña"
      onSubmit={resetPassword}
      loading={loading}
      onCancel={toLogin}
      extra={
        <Pressable
          onPress={requestCode}
          disabled={loading || secondsLeft > 0}
          accessibilityRole="button"
          hitSlop={8}>
          <Text style={[styles.resend, secondsLeft > 0 && styles.resendDisabled]}>
            {secondsLeft > 0 ? `Reenviar código en ${secondsLeft} s` : 'Reenviar código'}
          </Text>
        </Pressable>
      }>
      <CodeField
        label="Código de verificación"
        placeholder="00000000"
        value={code}
        onChangeText={edit('code', setCode)}
        error={errors.code}
        editable={!loading}
        returnKeyType="next"
      />
      <PasswordField
        kind="new"
        label="Nueva contraseña"
        placeholder="Crea una nueva contraseña"
        value={next}
        onChangeText={edit('next', setNext)}
        error={errors.next}
        hint={PASSWORD_HINT}
        editable={!loading}
        returnKeyType="next"
      />
      <PasswordField
        kind="new"
        label="Confirmar nueva contraseña"
        placeholder="Repite la nueva contraseña"
        value={confirm}
        onChangeText={edit('confirm', setConfirm)}
        error={errors.confirm}
        editable={!loading}
        returnKeyType="done"
        onSubmitEditing={resetPassword}
      />
    </PasswordScreen>
  );
}

const styles = StyleSheet.create({
  resend: { fontSize: 15, fontWeight: '700', textAlign: 'center', color: Palette.primary },
  resendDisabled: { color: Palette.textSecondary },
});
