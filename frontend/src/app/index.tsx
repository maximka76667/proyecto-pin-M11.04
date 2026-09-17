import { useState } from 'react';
import { StyleSheet, Text, View, Button } from 'react-native';

export default function App() {
  const [mensaje, setMensaje] = useState('Esperando conexión...');

  const probarConexion = async () => {
    try {
      const respuesta = await fetch('http://localhost:3000/');
      const texto = await respuesta.text();
      setMensaje(texto);
    } catch (e) {
      setMensaje('Error al conectar: ');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.texto}>{mensaje}</Text>
      <Button title="Llamar al Backend" onPress={probarConexion} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  texto: {
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
    color: 'blue',
  }
});