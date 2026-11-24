# AVD-PIN · Entrega 2: borrador de texto para la memoria

Borrador para las secciones 2 y 3 de la memoria (validación). Todo lo que aquí se afirma está medido en el repositorio o sale directamente del código. Los fragmentos de código son reales (copiados de los archivos indicados). Si aparece una marca `[POR COMPLETAR]` es un dato que todavía no se ha medido y no se ha inventado (la tabla de RNF-01 ya está completa con los códigos medidos).

Requisitos validados esta semana: **RF-01** Registro y reparto de gastos compartidos, **RF-02** Cálculo y simplificación del balance, **RNF-01** Seguridad y aislamiento por hogar. **RNF-02** (Accesibilidad visual, WCAG 2.1) queda descrito y marcado como **pendiente**.

---

## 1. Automatización

### 1.1 Herramientas

Todas las pruebas se ejecutan con un único comando (`npm test`) tanto en local como en la integración continua.

| Herramienta | Para qué se usa | Dónde |
|---|---|---|
| **Jest** (con ts-jest) | Ejecutor de todas las pruebas del backend y medidor de cobertura (Istanbul, `npm run test:cov`) | `backend/` |
| **supertest** | Peticiones HTTP reales contra la aplicación NestJS, con la misma validación que usa la app en producción | specs de `backend/src/transactions/` |
| **fast-check** | Pruebas de propiedades: se enuncia una regla y la herramienta la comprueba con cientos de casos generados al azar, con una semilla fija para poder repetirlos | `*.property.spec.ts` |
| **Prisma en memoria** (`backend/test/prisma-en-memoria.ts`) | Base de datos simulada que lee `schema.prisma` (relaciones, valores por defecto, borrado en cascada) y permite leer los datos después de cada petición | pruebas de aislamiento y de saldar deudas |
| **GitHub Actions** | En cada cambio ejecuta la compilación y `npm test -- --ci` del backend, y `tsc`, lint y pruebas del frontend | `.github/workflows/ci.yml` |

Comandos:

```
cd backend
npm test -- --ci          # todas las pruebas
npm run test:cov          # pruebas + informe de cobertura
npm test -- balance-calculator.property expense-split.property --ci   # solo las de propiedades
```

### 1.2 Ejemplo trabajado 1: prueba de propiedades del cálculo de balances (RF-02)

El requisito RF-02 pide que, al aplicar los pagos que devuelve la app, todos los balances queden a cero. En vez de comprobar unos pocos casos escritos a mano, la prueba genera listas de 2 a 8 usuarios con importes aleatorios cuya suma es cero y comprueba la regla en cada una (500 casos, semilla 42). Archivo: `backend/src/transactions/balance-calculator.property.spec.ts`.

```ts
// De 2 a 8 usuarios con céntimos enteros en [-100000, 100000]. El último valor se
// fija al opuesto de la suma del resto, así la lista suma cero exactamente
const balancesArb: fc.Arbitrary<BalanceUsuario[]> = fc
  .array(fc.integer({ min: -100000, max: 100000 }), { minLength: 1, maxLength: 7 })
  .map((centimos) => {
    const suma = centimos.reduce((total, c) => total + c, 0);
    return [...centimos, -suma].map((c, i) => ({
      userId: `u${i}`,
      balanceNeto: c / 100,
    }));
  });

it('los pagos dejan todos los balances exactamente a cero (en céntimos)', () => {
  fc.assert(
    fc.property(balancesArb, (balances) => {
      const pagos = calcularMinimosPagos(balances);

      return balances.every((usuario) => {
        // Quien debe (balance negativo) paga y sube; quien cobra baja
        const pagado = pagos
          .filter((p) => p.deudorId === usuario.userId)
          .reduce((total, p) => total + Math.round(p.monto * 100), 0);
        const cobrado = pagos
          .filter((p) => p.acreedorId === usuario.userId)
          .reduce((total, p) => total + Math.round(p.monto * 100), 0);
        const resultado = Math.round(usuario.balanceNeto * 100) + pagado - cobrado;
        return resultado === 0;
      });
    }),
    { numRuns: 500, seed: 42 },
  );
});
```

La misma suite comprueba otras tres propiedades: hay como máximo n−1 pagos, ningún pago es de menos de 0,01 € y cada pago va de un deudor (balance negativo) a un acreedor (balance positivo) distinto. El algoritmo es voraz, así que se garantiza **como máximo n−1 pagos**; no se afirma que sea el mínimo posible.

**Qué encontró esta prueba.** En una primera versión se exigía que todo pago fuera mayor de 0,01 €. La herramienta devolvió un contraejemplo reducido al caso mínimo: balances `[-0.09, -0.05, 0.04, 0.10]`. Tras el primer pago de 0,09 € al acreedor de 0,10 €, el resto no era `0.01` sino `0.010000000000000009` (error de coma flotante), un poco por encima del umbral, de modo que aparecía un pago de 0,01 € que el código decía ignorar; y un balance de exactamente ±0,01 € sí se ignoraba. Se corrigió `calcularMinimosPagos` para trabajar en céntimos enteros y la propiedad principal pasó a exigir cero exacto en lugar de una tolerancia de 1 céntimo. Este defecto no lo detectaban las pruebas escritas a mano.

### 1.3 Ejemplo trabajado 2: prueba de aislamiento por hogar (RNF-01)

Para RNF-01 hay un hogar A (con Ana y Beto) y un hogar B (con Carla y Dani, con un gasto, un ticket y un aviso de pago pendiente). Ana, que solo es de A, lanza una petición real contra cada endpoint financiero apuntando a datos de B. Una sola función comprueba lo mismo en los 12 endpoints. Archivo: `backend/src/transactions/transactions.aislamiento.spec.ts`.

```ts
async function comprobarBloqueo(
  endpoint: string,
  enviar: () => Promise<request.Response>,
  { esLista = false } = {},
) {
  const antes = datosDeB();

  const respuesta = await enviar();
  registro.push({ endpoint, status: respuesta.status });

  // Primero lo que importa de verdad: si algo cambió en B, el fallo enseña las filas de más
  expect(datosDeB()).toEqual(antes);

  // Luego lo que cuenta la respuesta, antes del código: si algo se filtra, el fallo lo enseña
  const cuerpo = JSON.stringify(respuesta.body);
  for (const secreto of SECRETOS_DE_B) {
    expect(cuerpo).not.toContain(secreto);
  }

  if (esLista) {
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual([]);
  } else {
    expect([403, 404]).toContain(respuesta.status);
  }
}

it('GET /transactions/:apartmentId/settle-up no enseña las deudas de otro hogar', async () => {
  await comprobarBloqueo('GET /transactions/:apartmentId/settle-up', () =>
    comoAna().get(`/transactions/${PISO_B}/settle-up`),
  );
});
```

Cada prueba comprueba cuatro cosas: (1) que los datos del hogar B son idénticos antes y después de la petición, de modo que un código 403 no oculte una escritura que sí ocurrió; (2) que la respuesta no contiene nombres, conceptos ni importes de B; (3) que el código es 403 o 404; (4) que la petición queda anotada para el recuento final.

**Qué encontró esta prueba.** Antes de arreglarlo, `POST /transactions` respondió 201: un usuario ajeno a un piso podía crear un gasto de 99,00 € en ese piso a nombre de otro usuario, y la comparación de datos mostró las dos filas nuevas (un gasto y una deuda de Carla a Dani) en el hogar B.

---

## 2. Cobertura

### 2.1 Cómo se ha medido

Con el medidor de cobertura integrado de Jest (Istanbul), sobre todo el código fuente del backend, con Node 24:

```
cd backend && npm run test:cov
```

Resultado de la última ejecución: **61 suites y 882 pruebas pasadas, 1 omitida** (una prueba pendiente del módulo de documentos, ajena a estos requisitos). El informe completo está en `docs/coverage-backend.txt`.

### 2.2 Resultados de los archivos de los requisitos

| Archivo | % Sentencias | % Ramas | % Funciones | % Líneas | Sin cubrir |
|---|---|---|---|---|---|
| `balance-calculator.ts` | 100 | 100 | 100 | 100 | nada |
| `expense-split.ts` | 100 | 100 | 100 | 100 | nada |
| `expenses.service.ts` | 100 | 92,85 | 100 | 100 | ramas en las líneas 80, 190, 277, 380-404 |
| `transactions.service.ts` | 96,29 | 83,45 | 96,29 | 96,55 | líneas 193, 298, 304, 341, 351, 638, 674 |
| Carpeta `src/transactions` | 98,34 | 86,56 | 98,18 | 98,44 | |
| Todo el backend (solo contexto) | 83,18 | 69,22 | 83,61 | 84,55 | |

Evolución de `transactions.service.ts` al añadir las pruebas de la pantalla de saldar deudas y de los caminos de error:

| | % Sentencias | % Ramas | % Funciones | % Líneas |
|---|---|---|---|---|
| Antes | 84,72 | 62,40 | 81,48 | 85,22 |
| Después | 96,29 | 83,45 | 96,29 | 96,55 |

### 2.3 Por qué estos casos

Los casos no se eligieron para llegar a un porcentaje, sino a partir de los casos de aceptación de cada requisito, buscando en cada uno un **límite o un caso que pudiera fallar**:

- **RF-01:** el importe máximo (10000,00 aceptado y 10000,01 rechazado), importe cero o negativo, concepto vacío, pagador obligatorio (400 si falta `from_user_id`) y el reparto exacto de céntimos (10,00 € entre tres = 3,34 + 3,33 + 3,33).
- **RF-02:** balances exactos al céntimo y pagos que los dejan a cero, estado vacío (sin deudas no hay pagos ni NaN), ciclo cerrado (no produce pago) y la pantalla de saldar deudas.
- **RNF-01:** el 100 % de los 12 endpoints financieros definidos, cada uno con una petición de alguien ajeno al hogar.

La cobertura se usó **después**, como instrumento para encontrar huecos reales. La primera medición dejó sin ejecutar toda la pantalla de saldar deudas de un miembro (unas 45 líneas) y los errores 404/409 de confirmar y rechazar; de ahí salieron las pruebas de `transactions.settle-up.spec.ts`.

### 2.4 Por qué no es 100 %

- **Funciones puras (`balance-calculator.ts`, `expense-split.ts`):** 100 %, y además con pruebas de propiedades (500 y 1000 casos aleatorios) que comprueban los resultados y no solo que las líneas se ejecutan.
- **Traducción de errores de Prisma (`transactions.service.ts`, líneas 298, 304, 638, 674):** necesita errores de base de datos que la base simulada no produce. Queda como trabajo futuro.
- **Saldo público por código de invitación (341, 351):** fuera de alcance; el endpoint es público por diseño y no forma parte de RNF-01.
- **Línea 193 (total del ticket ≤ 0):** probablemente inalcanzable por HTTP, porque el DTO ya rechaza un precio cero o negativo antes de llegar al servicio (no comprobado con una prueba). Se mantiene como comprobación defensiva.
- **`expenses.service.ts`, ramas (80, 190, 277, 380-404):** todas sus líneas y funciones están cubiertas; solo faltan alternativas no tomadas de condiciones ya ejercitadas (valor por defecto de un parámetro opcional, un lado de un condicional, algunos `??` y `?.`).
- **Todo el backend (83 %):** incluye módulos ajenos a los requisitos (notificaciones push al 0 %, correo, contraseñas, almacenamiento de documentos). Solo se da como contexto.

### 2.5 Qué mide y qué no mide la cobertura

La cobertura indica qué líneas se ejecutaron, no que el resultado fuera correcto; por eso las funciones puras tienen además pruebas de propiedades. Varias pruebas usan bases de datos simuladas o el Prisma en memoria, no Postgres: demuestran lo que hace el servicio, no lo que haría la base de datos real.

---

## 3. Análisis de resultados

### 3.1 Resultados por requisito

**RF-01 Registro y reparto de gastos.** Las cinco pruebas de aceptación se cumplen. Se corrige un dato de la memoria: el importe máximo es **10000,00 €** (lo aplican la expresión regular de `create-transaction.dto.ts` y `update-expense.dto.ts`), no 999.999.999 €. El mensaje de error del pagador obligatorio es `from_user_id must be a UUID`; la memoria debe citar ese o describirlo como «400 con un mensaje que nombra `from_user_id`».

**RF-02 Cálculo y simplificación del balance.** Los balances son exactos al céntimo y los pagos los dejan a cero (500 casos aleatorios, semilla 42). La garantía es de **como máximo n−1 pagos**, no del mínimo. No hay pagos con NaN, Infinity ni transferencias de 0 €.

**RNF-01 Seguridad y aislamiento por hogar.** La suite tiene 14 pruebas (12 endpoints financieros más 2 casos adicionales de `POST /transactions`) y las 14 pasan. Los 12 endpoints financieros bloquean a un usuario de otro hogar; las dos listas «mías» (`GET /expenses` y `GET /transactions`) responden 200 con una lista vacía, igual que a un miembro sin gastos, y se cuentan aparte. En ningún caso la respuesta contiene importes ni nombres del otro hogar y los datos del hogar B no cambian. Esto se cumple **después de corregir cuatro hallazgos**, descritos abajo.

| Endpoint | Tipo | Resultado esperado | Código observado |
|---|---|---|---|
| `GET /expenses` | lectura (lista) | 200 con `[]` | 200 |
| `GET /transactions` | lectura (lista) | 200 con `[]` | 200 |
| `GET /transactions/:apartmentId/my-summary` | lectura | 403/404 | 403 |
| `GET /transactions/:apartmentId/settle-up` | lectura | 403/404 | 403 |
| `PATCH /expenses/:id` | escritura | 403/404 | 403 |
| `DELETE /expenses/:id` | escritura | 403/404 | 403 |
| `DELETE /receipts/:id` | escritura | 403/404 | 403 |
| `POST /transactions` | escritura | 403/404 | 403 |
| `POST /transactions/from-receipt` | escritura | 403/404 | 403 |
| `POST /transactions/:apartmentId/settle` | escritura | 403/404 | 403 |
| `POST /transactions/:id/confirm` | escritura | 403/404 | 403 |
| `POST /transactions` con un pagador de otro hogar (caso adicional, lo envía Beto, que sí es del piso A) | escritura | 400 y no se guarda nada | 400 |
| `POST /transactions` con un deudor de otro hogar (caso adicional, lo envía Beto) | escritura | 400 y no se guarda nada | 400 |

**Recuento: 14 pruebas, las 14 pasan.** Son 12 pruebas de endpoint con una petición de Ana, que no pertenece al hogar B, más 2 casos adicionales de `POST /transactions` enviados por un miembro del hogar A que intenta meter en su gasto a alguien de B. Las 12 peticiones de Ana: 10 bloqueadas con 403/404 (todas con 403) y 2 aisladas con 200 y lista vacía (`GET /expenses` y `GET /transactions`). Los 2 casos adicionales responden 400 con el mensaje `All participants must belong to the apartment` y no escriben ninguna fila; no entran en el recuento de las 12 peticiones porque no son de un usuario ajeno al piso.

**Fuera de alcance, y así se dice:** el saldo público (`GET /transactions/public-balance/:inviteCode`), público por diseño, y las tareas, puntos, disponibilidad, notificaciones y documentos, que también guardan datos del hogar pero no forman parte del requisito financiero. Los endpoints financieros son el conjunto probado; el resto queda pendiente.

**RNF-02 Accesibilidad visual (WCAG 2.1).** Descrito y **pendiente**, no validado: el rediseño del que depende no está terminado. Se validará para la entrega final de enero con pruebas automáticas de accesibilidad (axe-core mediante jest-axe, criterio: cero violaciones de impacto crítico o grave), una prueba de contraste (al menos 4,5:1 para texto normal y 3:1 para texto grande, leyendo los colores de `frontend/src/constants/theme.ts`) y, como comprobación opcional, una auditoría de Lighthouse sobre la versión web. La lista de pantallas se acordará en el grupo antes de ejecutar las pruebas.

### 3.2 Hallazgos y qué se hizo con ellos

| # | Hallazgo | Gravedad | Resultado |
|---|---|---|---|
| 1 | `calcularMinimosPagos` comparaba números en coma flotante con un umbral de 0,01: según el ruido numérico aparecía o no un pago de 1 céntimo, y un balance de exactamente ±0,01 € se ignoraba | Baja | **Corregido**: el cálculo trabaja en céntimos enteros. Cambio de comportamiento: un balance de ±0,01 € ahora se salda |
| 2 | `POST /transactions` no comprobaba que quien llama, el pagador y los deudores fueran del piso, y el pagador salía del cuerpo de la petición. Un usuario ajeno podía crear un gasto de 99,00 € en otro hogar a nombre de otro usuario (respuesta 201) | **Vulnerabilidad** | **Corregido**: 403 si quien llama no es del piso; 400 si el pagador o un deudor no lo es |
| 3 | `GET /transactions/:apartmentId/my-summary` no comprobaba la pertenencia al piso y respondía 200 a un usuario ajeno. No se midió ninguna fuga de nombres ni importes | Baja (falta de comprobación, sin fuga medida) | **Corregido**: 403 como en `settle-up` |
| 4 | `POST /transactions/from-receipt` respondía 400 a un usuario ajeno si el piso existía y 404 si no existía, de modo que un ajeno podía distinguir un piso real de uno inventado. No se escribió nada | Baja | **Corregido**: 403 en ambos casos |

Los cuatro los encontraron pruebas automáticas, no una revisión manual. En cada caso la corrección se comprobó volviendo a ejecutar la misma prueba y toda la batería.

### 3.3 Análisis crítico

- **Lo que la validación sí demuestra:** que, en el conjunto definido de 12 endpoints financieros y con un atacante que no pertenece al hogar, ninguna petición lee ni cambia datos del otro hogar, y que las reglas de reparto y de balance se cumplen en miles de casos aleatorios.
- **Una vulnerabilidad real salió a la luz** (`POST /transactions`). Antes de este trabajo no había ninguna prueba de aislamiento por hogar para ese endpoint que lo detectara.
- **Límites de la validación.** (1) Las pruebas de aislamiento usan el Prisma en memoria, no Postgres: la comprobación posterior demuestra que el servicio no escribió, no que Postgres no cambió. (2) Se prueba un único atacante que no pertenece a ningún hogar relacionado; no se probó, por ejemplo, un antiguo miembro que conserva deudas. (3) Cobertura no es corrección: la de ramas de `transactions.service.ts` es del 83 %. (4) Los demás datos del hogar (tareas, puntos, disponibilidad, notificaciones, documentos) y las rutas de `apartments` y `users` no se han revisado, así que no se afirma nada sobre ellos.
- **403 frente a 404.** En los endpoints identificados por un id de recurso (`PATCH`/`DELETE /expenses/:id`, `DELETE /receipts/:id`, `confirm`, `reject`) la respuesta es 403, que revela que el recurso existe (uno inexistente da 404). En los endpoints con el piso en la URL no debería haber fuga, porque la comprobación busca el par (usuario, piso) y un piso inexistente y uno ajeno dan la misma respuesta (conclusión sacada de leer el código, no medida por una prueba). Se registra como limitación conocida.

### 3.4 Acciones propuestas

1. **Devolver 404 a los ajenos** en los endpoints por id de recurso, comprobando primero la pertenencia al hogar y manteniendo 403 para el miembro que no es el pagador.
2. **Repetir las pruebas de aislamiento contra un Postgres real** (por ejemplo, una base desechable en el CI) y probar la traducción de errores de Prisma, hoy sin cubrir.
3. **Ampliar RNF-01** a las rutas pendientes: `apartments/:id/members`, `PATCH`/`DELETE /apartments/:id`, `users/:id`, disponibilidad, documentos, tareas y puntos, empezando por las que devuelven nombres de otros hogares.
4. **Añadir un caso de antiguo miembro** (alguien que dejó el piso y conserva deudas) para `settle`, y una prueba de que `from-receipt` rechaza con 400 a un participante que no es del piso.
5. **Mantener las pruebas de propiedades en el CI** y añadir una por cada nueva regla de cálculo.
6. **Validar RNF-02** en enero con el método descrito, una vez terminado el rediseño.
