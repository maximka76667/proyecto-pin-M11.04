// Los imports de .css (global.css y los *.module.css de la versión web) los resuelve Metro.
// Expo genera estos tipos en expo-env.d.ts al arrancar, pero ese archivo no está en git,
// así que sin esta declaración `tsc` falla en el CI.
declare module '*.css';
