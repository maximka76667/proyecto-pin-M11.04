import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { Palette, Radius } from '@/constants/onboarding';
import { RESET_CODE_DIGITS } from '@/lib/password-policy';

type BaseProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string;
  // Texto de ayuda bajo el campo; si hay error se muestra el error en su lugar
  hint?: string;
  editable?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
};

// Campo de contraseña de la pantalla "Cambiar contraseña": oculto por defecto,
// con el ojo para ver lo escrito. "kind" indica al gestor de contraseñas del
// sistema si debe rellenar la guardada (current) o proponer una nueva (new)
export function PasswordField({ kind, ...props }: BaseProps & { kind: 'current' | 'new' }) {
  const [visible, setVisible] = useState(false);

  return (
    <FieldShell {...props}>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={Palette.textSecondary}
        editable={props.editable}
        returnKeyType={props.returnKeyType}
        onSubmitEditing={props.onSubmitEditing}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={kind === 'current' ? 'current-password' : 'new-password'}
        textContentType={kind === 'current' ? 'password' : 'newPassword'}
        accessibilityLabel={props.label}
        style={styles.input}
      />
      <Pressable
        onPress={() => setVisible((current) => !current)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        style={styles.eye}>
        <MaterialCommunityIcons
          name={visible ? 'eye-outline' : 'eye-off-outline'}
          size={22}
          color={Palette.textSecondary}
        />
      </Pressable>
    </FieldShell>
  );
}

// Código de 6 dígitos del email de recuperación. Visible: es de un solo uso y caduca
export function CodeField(props: BaseProps) {
  return (
    <FieldShell {...props}>
      <TextInput
        value={props.value}
        onChangeText={(text) =>
          props.onChangeText(text.replace(/\D/g, '').slice(0, RESET_CODE_DIGITS))
        }
        placeholder={props.placeholder}
        placeholderTextColor={Palette.textSecondary}
        editable={props.editable}
        returnKeyType={props.returnKeyType}
        onSubmitEditing={props.onSubmitEditing}
        keyboardType="number-pad"
        maxLength={RESET_CODE_DIGITS}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        accessibilityLabel={props.label}
        style={[styles.input, styles.code]}
      />
    </FieldShell>
  );
}

// Email del primer paso de la recuperación, con el mismo aspecto
export function EmailField(props: BaseProps) {
  return (
    <FieldShell {...props}>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={Palette.textSecondary}
        editable={props.editable}
        returnKeyType={props.returnKeyType}
        onSubmitEditing={props.onSubmitEditing}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        accessibilityLabel={props.label}
        style={styles.input}
      />
    </FieldShell>
  );
}

function FieldShell({ label, error, hint, children }: BaseProps & { children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>{children}</View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 15, fontWeight: '700', color: Palette.text },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: Palette.background,
  },
  boxError: { borderColor: Palette.error },
  input: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 16,
    fontSize: 15,
    color: Palette.text,
  },
  code: { letterSpacing: 6, fontSize: 18, fontWeight: '700' },
  eye: { paddingHorizontal: 14, alignSelf: 'stretch', justifyContent: 'center' },
  hint: { fontSize: 13, lineHeight: 18, color: Palette.textSecondary },
  error: { fontSize: 13, lineHeight: 18, color: Palette.error },
});
