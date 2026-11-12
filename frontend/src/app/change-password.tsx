import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';

import { PasswordField } from '@/components/password-field';
import { PasswordScreen } from '@/components/password-screen';
import { api, hasAuthToken, setAuthToken } from '@/lib/api';
import {
  describeApiError,
  hasErrors,
  PASSWORD_HINT,
  validatePasswordChange,
  type FieldErrors,
  type PasswordField as Field,
} from '@/lib/password-policy';

// "Cambiar contraseña" desde Mi cuenta (PA-1015.01, .03 y .04)
export default function ChangePasswordScreen() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasAuthToken()) {
        router.replace('/auth' as Href);
        return;
      }
      // Una cuenta de Google no tiene contraseña que cambiar: vuelve a Mi cuenta
      let active = true;
      void (api('GET', '/users/me') as Promise<{ has_password: boolean }>)
        .then((me) => {
          if (active && !me.has_password) router.replace('/profile' as Href);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile' as Href);
  };

  // Al escribir en un campo desaparece su error
  const edit = (field: Field, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined }));
    if (generalError) setGeneralError('');
  };

  const submit = async () => {
    if (loading) return;

    // Si algo no cumple las reglas no se hace ninguna petición
    const localErrors = validatePasswordChange({ current, next, confirm });
    setErrors(localErrors);
    setGeneralError('');
    if (hasErrors(localErrors)) return;

    setLoading(true);
    try {
      const result = (await api('POST', '/auth/change-password', {
        current_password: current,
        new_password: next,
        confirm_password: confirm,
      })) as { token?: string };

      // El backend invalida los tokens anteriores y devuelve uno nuevo para este
      // dispositivo, así que la sesión aquí sigue activa (PA-1015.02)
      if (result.token) setAuthToken(result.token);
      setCurrent('');
      setNext('');
      setConfirm('');
      router.dismissTo({ pathname: '/profile', params: { notice: 'password-updated' } } as Href);
    } catch (error) {
      const { fields, general } = describeApiError(
        error,
        'No se ha podido cambiar la contraseña. Inténtalo más tarde.',
      );
      setErrors(fields);
      setGeneralError(general ?? '');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PasswordScreen
      backLabel="Mi cuenta"
      onBack={goBack}
      title="Cambiar contraseña"
      subtitle="Cuida tu cuenta con una contraseña nueva y segura."
      error={generalError}
      submitLabel="Guardar contraseña"
      onSubmit={submit}
      loading={loading}
      onCancel={goBack}>
      <PasswordField
        kind="current"
        label="Contraseña actual"
        placeholder="Introduce tu contraseña actual"
        value={current}
        onChangeText={edit('current', setCurrent)}
        error={errors.current}
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
        onSubmitEditing={submit}
      />
    </PasswordScreen>
  );
}
