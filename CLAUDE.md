# CONTEXTO MAESTRO DEL PROYECTO
## Sistema Web — Ferretería Casa Hogar

Usar este documento como contexto base antes de modificar cualquier parte del proyecto. El sistema ya tiene lógica, base de datos, roles, permisos y módulos implementados. No debe reconstruirse desde cero ni sustituirse la arquitectura sin una razón técnica real.

---

## 1. Descripción general

Sistema web integral para Ferretería Casa Hogar (Managua, Nicaragua). Dos áreas totalmente separadas:

- **Sistema interno** — exclusivo de trabajadores. Rutas: `/login`, `/app`. Módulos administrativos, compras, inventario, ventas, caja, reportes.
- **Tienda en línea** — clientes externos. Rutas: `/tienda`, `/tienda/login`, `/tienda/carrito`, `/tienda/mi-cuenta`. Consultar productos, carrito, autenticarse, hacer pedidos.

Las cuentas de empleados y las de clientes NO son lo mismo. Un trabajador no debe autenticarse como cliente de la tienda y un cliente no debe entrar al sistema administrativo.

## 2. Tecnologías

- Frontend: React, TypeScript, Vite, CSS.
- Backend: Supabase (PostgreSQL, Auth, RLS, funciones/RPC, Storage).
- Repositorio: Git/GitHub. Despliegue: Vercel.
- Arquitectura: **monolito modular** (no microservicios). Proyecto académico, equipo pequeño, módulos con fuertes dependencias.

## 3. Principio de arquitectura

Una sola aplicación React. Módulos separados lógicamente pero comparten autenticación, BD, inventario, productos, ventas, compras, caja, usuarios y reportes. Supabase es el backend centralizado.

- React NUNCA usa la `service_role`; solo la configuración pública de Supabase.
- La seguridad real va en RLS, RPC, funciones PostgreSQL, constraints y transacciones. No confiar en ocultar botones desde React.

## 4. Ruteo actual

No se usa React Router. Router simple con `window.location.pathname`, `history.pushState()` y `popstate` (ver `App()` en `src/App.tsx`).

```text
/                  → /login
/login             → login del sistema interno
/app               → aplicación administrativa
/tienda            → catálogo público
/tienda/login      → login / registro de clientes
/tienda/carrito    → carrito
/tienda/mi-cuenta  → cuenta e historial del cliente
```

`vercel.json` tiene el rewrite SPA `/(.*) → /index.html` para evitar 404 en rutas directas.

## 5. Autenticación

Supabase Auth, con dos tipos de cuenta:

- **Cuenta interna** (trabajadores): tras el login se consulta perfil (`profiles`) y rol (`roles`). Entra a `/app`.
- **Cuenta cliente** (compradores): relacionada con `clientes_web`. Entra a `/tienda/mi-cuenta`.

## 6. Función para diferenciar cuentas

`tipo_cuenta_actual()` devuelve: `personal`, `personal_sin_rol`, `personal_inactivo`, `cliente_web`, `cliente_inactivo`, `conflicto`, `sin_perfil` (o `sin_sesion`).

El frontend la usa para impedir accesos incorrectos:
- Empleado en `/tienda/login` → rechazado como cliente.
- Cliente en `/login` → rechazado del sistema interno.

## 7. Clientes web

Tabla `clientes_web` (1:1 con `auth.users`). El trigger `handle_new_user()` crea el registro en `clientes_web` si el metadata trae `account_type = 'cliente_web'`; en otro caso crea el perfil de personal en `profiles`.

## 8. Roles del sistema

```text
gerencia, administracion, vendedor, responsable_comercial, responsable_caja,
almacen, encargado_compras, responsable_compras, marketing_digital,
soporte_ti, propietario
```

Rol antiguo `ventas`: se conserva temporalmente por compatibilidad con políticas/módulos antiguos. NO eliminarlo hasta verificar todas las RLS y funciones relacionadas.

## 9. Cuentas de prueba

```text
almacen@casahogar.test               → almacen
encargado.compras@casahogar.test     → encargado_compras
gerencia@casahogar.test              → gerencia
responsable.compras@casahogar.test   → responsable_compras
ventas@casahogar.test                → vendedor
responsable.comercial@casahogar.test → responsable_comercial
marketing@casahogar.test             → marketing_digital
caja@casahogar.test                  → responsable_caja
propietario@casahogar.test           → propietario
```

## 10. Separación de responsabilidades

Principio: **Actor → Módulo → Submódulo → Función**.

```text
Encargado de Compras   → Compras → Solicitudes/órdenes → Crear y gestionar compra
Responsable de Compras → Compras → Autorización        → Aprobar o rechazar compra
Bodeguero (almacen)    → Inventario/Bodega → Recepción → Confirmar producto recibido
Vendedor               → Ventas → Venta                → Registrar venta
Responsable de Caja    → Caja → Cobros                 → Cobrar venta
Propietario            → Dashboard/Reportes → Consulta → Analizar el negocio
```

El Propietario NO interviene en operaciones técnicas.

## 11. Módulos principales

Autenticación, Usuarios, Roles, Productos, Categorías, Inventario, Bodega, Compras, Proveedores, Clientes, Cotizaciones, Ventas, Caja, Cuentas por cobrar, Devoluciones, Reportes, Analítica, Dashboard, Alertas, Tienda en línea, Pedidos web.

## 12. Productos

Catálogo central único, reutilizado en Compras, Inventario, Ventas, Tienda y Reportes. Se relaciona con categorías, marcas, modelos, colores, materiales y unidades de medida. El producto NO se duplica por módulo.

## 13. Inventario

Centralizado (`existencias` + `movimientos_inventario`). Todo cambio real de inventario produce un movimiento trazable:

```text
Compra recibida               → entrada
Venta                         → salida
Devolución aceptada a inventario → entrada
Ajuste                        → movimiento de ajuste
```

Nunca modificar stock silenciosamente.

## 14. Flujo general del negocio

```text
LOGIN → VENTA → COBRO/CAJA → DESCUENTO DE INVENTARIO → VERIFICACIÓN DE STOCK
→ ALERTA DE STOCK BAJO → REPOSICIÓN SUGERIDA → COMPRA → RECEPCIÓN EN BODEGA
→ ENTRADA AL INVENTARIO → ACTUALIZACIÓN DE INDICADORES → REPORTES → DASHBOARD
→ DECISIONES DEL PROPIETARIO
```

## 15. Compras

Roles: `encargado_compras` (prepara), `responsable_compras` (revisa/autoriza), `almacen` (recibe), `administracion`. Proveedor suministra; inventario actualiza existencias. El Propietario no registra compras; solo consulta indicadores.

## 16. Bodega / Almacén

Rol `almacen` (Bodeguero): recepción de mercancía, verificación, existencias, movimientos, kardex/trazabilidad.

## 17. Ventas

`vendedor` registra ventas; `responsable_comercial` supervisa/consulta; `gerencia` consulta. Lógica diferenciada por `roleCode`: el frontend no muestra las mismas acciones a todos los roles.

## 18. Clientes

Módulo de clientes comerciales internos (`clientes`): vendedor crea/modifica; responsable comercial y gerencia consultan. NO confundir con `clientes_web` (cuentas de la tienda en línea).

## 19. Cotizaciones

Vendedor crea, edita y emite; responsable comercial y gerencia consultan. Tablas: `cotizaciones`, `detalle_cotizaciones`.

## 20. Caja

Rol `responsable_caja`. Menú: Apertura, Cobros, Movimientos, Arqueo, Cierre, Historial. Flujo: abrir caja → cobros → movimientos → arqueo → cerrar → historial. Numeración con `sesion_caja_numero_seq` (`CAJ-000001`).

## 21. Funciones de caja / ventas

`abrir_caja`, `cobrar_venta`, `registrar_abono_venta`, `aplicar_devolucion_financiera`, `reembolsar_devolucion_venta`, `anular_venta`. No sustituir operaciones críticas por múltiples INSERT/UPDATE desde React si ya existe una función transaccional.

## 22. Cuentas por cobrar

`cuentas_por_cobrar` controla ventas con saldo pendiente. Reportes: cuentas pendientes, vencidas, pagos registrados, saldos.

## 23. Devoluciones

Tablas `devoluciones_venta`, `detalle_devoluciones_venta`. Vendedor registra solicitud → Responsable Comercial revisa y confirma o anula → destino Inventario o Merma. Funciones: `registrar_devolucion_venta`, `confirmar_devolucion_venta`, `anular_devolucion_venta`, `reembolsar_devolucion_venta`, más lógica financiera asociada.

## 24. Tablas con RLS ya trabajadas

`clientes`, `cotizaciones`, `detalle_cotizaciones`, `cuentas_por_cobrar`, `detalle_ventas`, `devoluciones_venta`, `detalle_devoluciones_venta`, `existencias`, `movimientos_caja`, `pagos_venta`. No modificar políticas RLS sin revisar primero qué roles dependen de ellas.

## 25. Seguridad

- React decide qué módulos y acciones mostrar, pero NO es la seguridad definitiva.
- PostgreSQL/Supabase: RLS, políticas por rol, RPC, constraints, transacciones.
- Principio de **mínimo privilegio**.

## 26. Dashboard del propietario

Rol `propietario`: Dashboard, Reportes y análisis, Alertas/recomendaciones. No administra usuarios ni hace tareas operativas. Backend: `dashboard_propietario`, `reportes_propietario`, `alertas_recomendaciones_propietario`.

## 27. Alertas del propietario

Detecta stock bajo, agotados, necesidad de reposición y situaciones relevantes de caja o ventas, para decidir sin revisar cada módulo operativo.

## 28. Tienda en línea

`/tienda`: catálogo público (no requiere login). Buscar, filtrar por departamento u ofertas, ordenar, ver disponibilidad, elegir cantidad y agregar al carrito. Rediseñada el 26/10/2026 con la identidad de la §35 (clases `t-*` en `Storefront.tsx`). **No rediseñar arbitrariamente.**

## 29. Catálogo público

`catalogo_publico()` alimenta la tienda con datos reales. Productos como "Destornillador/Martillo/Taladro de prueba" son registros de prueba.

## 30. Carrito

`/tienda/carrito`: agregar, aumentar/reducir cantidad, subtotal, total. Modalidades: retiro en tienda y entrega a domicilio. Confirmar pedido requiere cuenta de cliente.

## 31. Pedidos web

`pedidos_en_linea` (con `cliente_web_id`), secuencia `pedido_web_numero_seq`. Funciones: `registrar_pedido_web(...)`, `mis_pedidos_web()`.

El cliente elige la forma de pago en el carrito (`pedidos_en_linea.metodo_pago`: efectivo, tarjeta o transferencia; la cuenta bancaria mostrada es ficticia, constante `CUENTA_TRANSFERENCIA` en `Storefront.tsx`). `convertir_pedido_web_en_venta()` la copia a `ventas.metodo_pago_preferido`, porque caja no puede leer `pedidos_en_linea`; Caja → Cobros la preselecciona, pero `cobrar_venta()` registra el método real.

## 32. Login de clientes

`/tienda/login`, independiente de `/login`. Iniciar sesión y registrarse. Las cuentas internas son rechazadas como clientes.

## 33. Mi cuenta

`/tienda/mi-cuenta`: datos del cliente y pedidos (número, fecha, modalidad, total, estado).

## 34. Imágenes de productos

Hoy: placeholder "Imagen de producto". Plan: bucket `productos` en Supabase Storage + columna `imagen_url` en `productos`. Flujo: Sistema interno → Producto → Editar → Subir imagen → Storage → guardar `imagen_url` → la tienda la muestra. NO guardar binarios en PostgreSQL.

## 35. Diseño actual

Identidad aprobada el 26/10/2026 ("Casa Hogar Cálido"), aplicada a tienda y sistema interno desde `src/styles/tema-casa-hogar.css` (se carga después de `App.css`; sus variables `--ch-*` reemplazan las paletas anteriores):

- Fondo gris muy claro con tinte del azul del logo; superficies blancas.
- Naranja ferretero **solo para botones de acción**.
- Amarillo del logo para estados en proceso, la franja de avisos de la tienda y el avatar.
- Azul suave para lo seleccionado (menú activo, filtros, estado "Recibido").
- Gris acero del logo para la portada de ofertas y el panel del login de clientes.
- Texto marino del logo (solo en letras). Tipografías: Bricolage Grotesque (títulos y precios), Figtree (texto), IBM Plex Mono (SKU y números de documento).
- Logo real recortado: `src/assets/casa-hogar-logo-horizontal.png`.

No queremos: fondos oscuros (barra lateral, encabezados, pie), crema, durazno, líneas decorativas, apariencia de hotel, verde (salvo estados "ok"), café, interfaces recargadas, texto diminuto, emojis como imágenes de productos, logos gigantes, gradientes exagerados.

## 36. Header de la tienda

Franja amarilla de avisos; logo; buscador con selector de departamento; Mi cuenta; Carrito. El botón Carrito muestra ícono + texto "Carrito" + contador (en celular solo ícono + contador). Debajo, barra de departamentos con "Ofertas de la semana".

## 37. Footer

Pegado al final cuando hay poco contenido: página con `display:flex; flex-direction:column; min-height:100vh` y el contenido principal con `flex` empujando el footer.

**No aplicar `width: 100% !important` indiscriminadamente a todos los `<main>`**: antes estiró el catálogo y parecía tener zoom. El catálogo mantiene un ancho máximo centrado.

## 38. Estado visual de la tienda

Rediseñada y estabilizada (26/10/2026): portada de ofertas, mosaico de departamentos, tarjetas con descuento tachado y cantidad, banda "cómo comprar", pie claro, carrito con pasos, login con pestañas; dos productos por fila en celular. "Mi cuenta" y "Nueva contraseña" conservan clases `store-*` restiladas desde el tema. No hacer otro rediseño completo sin solicitud expresa.

Desde el 28/10/2026: la portada muestra solo productos en oferta (no categorías); hacer clic en la foto o el nombre de un producto abre una ventana de detalle con su descripción (no lo agrega al carrito: solo el botón "Agregar" lo hace); nombres en máximo dos líneas; el departamento no se repite en las tarjetas cuando ya se está dentro de uno.

El precio tachado y "Últimas unidades" requieren la migración `20261026202644_catalogo_publico_precios.sql` (agrega `precio_regular`, `descuento_porcentaje`, `unidad_medida`, `pocas_unidades` sin exponer la existencia exacta). Sin ella, la tienda funciona sin esos dos detalles.

## 39. Login interno

Centrado, sencillo, profesional, con logo Casa Hogar, siempre sobre fondo claro. Incluye "¿Olvidaste tu contraseña? Pide una temporal a Soporte TI" y enlace a la tienda. Sin logo gigante durante la carga: solo spinner + "Cargando sistema...".

La barra lateral del sistema interno es blanca, con el logo completo y el módulo activo en azul suave.

## 40. Sidebar del sistema

Elementos según el rol (`src/config/roleMenus.ts`). No mostrar módulos sin autorización.

## 41. Gerencia

Rol independiente. No confundir Propietario, Gerencia, Administración y Soporte TI. El trabajo específico de Gerencia quedó para una etapa posterior.

## 42. Propietario

Consulta estratégica: indicadores, reportes, tendencias, alertas, recomendaciones. NO administra usuarios, configura seguridad, registra ventas, opera caja ni recibe mercancía.

## 43. Responsable comercial

Supervisión comercial, consulta de clientes y cotizaciones, revisión de devoluciones, confirmación o anulación cuando corresponda.

## 44. Responsable de caja

`responsable_caja`: apertura, cobros, movimientos, arqueo, cierre, historial. Un único rol para caja y facturación por ahora.

## 45. Marketing digital

`marketing_digital`: separado de ventas, caja y administración. Funciones comerciales/digitales; sin permisos administrativos.

## 46. Soporte TI

`soporte_ti`: usuarios, roles, permisos, seguridad, configuración, auditoría técnica. Gerencia NO equivale a Soporte TI.

## 47. Validaciones

Validaciones de negocio en backend. Ej.: productos manejados por unidad no aceptan cantidades como `1.01`; la validación depende de la unidad de medida del producto.

## 48. Consistencia de datos

Operaciones importantes atómicas (venta + detalle + existencias + caja). Preferir RPC/funciones PostgreSQL para operaciones sensibles.

## 49. Concurrencia

Impedir stock negativo por ventas simultáneas. Las operaciones críticas de inventario se validan en PostgreSQL (bloqueos `FOR UPDATE`, constraints).

## 50. Auditoría

Trazabilidad de inventario, ventas, caja, devoluciones, compras y usuarios. No borrar trazabilidad para corregir datos: preferir anular, revertir o registrar movimiento contrario.

## 51. Lógica central

```text
USUARIO → AUTH → TIPO DE CUENTA → ROL → PERMISOS → MÓDULO → OPERACIÓN
→ RLS/RPC → POSTGRESQL → ACTUALIZACIÓN DE INVENTARIO/CAJA/DATOS → REPORTES → DASHBOARD
```

Tienda:

```text
VISITANTE → CATÁLOGO PÚBLICO → CARRITO → LOGIN/REGISTRO CLIENTE → PEDIDO WEB
→ BASE DE DATOS → GESTIÓN INTERNA DEL PEDIDO
```

## 52. Regla para modificaciones

1. Identificar qué módulo está afectado.
2. Determinar qué roles pueden utilizarlo.
3. Revisar si existe una RLS relacionada.
4. Revisar si existe una RPC ya implementada.
5. No duplicar lógica ya existente.
6. No cambiar nombres de roles arbitrariamente.
7. No borrar políticas antiguas sin verificar dependencias.
8. No modificar Supabase solo por resolver un problema visual.
9. Mantener frontend y backend separados conceptualmente.
10. Preservar lo que actualmente funciona.

## 53. Prioridad actual

Terminar un sistema académico funcional y demostrable, no un ERP gigantesco. Estrategia: procesos principales → seguridad → conectar módulos → diseño → pruebas. Trabajo futuro: offline avanzado, sincronización compleja, auditoría ampliada, PWA, analítica avanzada.

## 54. Alcance académico

Pensar en Actor → Módulo → Submódulo → Función. Evitar arquitectura innecesariamente compleja. Demostrar funcionalidad, integración, roles, seguridad, BD, procesos comerciales e interfaz.

## 55. Instrucciones para trabajar con este proyecto

- No reconstruir el proyecto desde cero.
- No inventar nuevos roles sin necesidad.
- No reemplazar Supabase.
- No cambiar la arquitectura sin consultarlo.
- No eliminar RLS para "hacer que funcione".
- No usar `service_role` en React.
- No mezclar clientes web con empleados.
- No convertir la tienda en el sistema interno.
- No mezclar Propietario con Gerencia.
- No eliminar funciones PostgreSQL que ya resuelven una transacción.
- Conservar los nombres existentes siempre que sea posible.
- Si una modificación es visual, no cambiar lógica backend.
- Si una modificación es backend, explicar qué tablas, políticas o funciones afecta.
- Para cambios grandes, indicar primero qué archivos realmente necesitan modificarse.
- Analizar la estructura real antes de proponer reemplazos completos.

## 56. Estado actual

Base funcional: autenticación interna, roles, permisos, RLS, productos, inventario, compras, clientes, cotizaciones, ventas, caja, cuentas por cobrar, devoluciones, dashboard/reportes/alertas del propietario, tienda pública, carrito, login de clientes, pedidos web.

Algunas áreas pueden necesitar terminación, integración o pruebas. No asumir que un módulo está 100 % terminado solo porque exista la tabla o la política. Revisar el código actual antes de cambiar algo.

## 57. Objetivo final

Internamente Casa Hogar controla compras, inventario, ventas, caja, clientes y reportes. Externamente el cliente consulta productos, prepara pedidos, usa su cuenta y consulta sus pedidos. Todo sobre la misma base central, con separación de roles, seguridad y trazabilidad.

## 58. Base de datos y migraciones

- `supabase/migrations/20261026120000_esquema_base.sql` es el punto de partida: volcado completo del esquema remoto (incluye trigger de auth, roles, bucket `productos` y privilegios). Verificado con `supabase db diff --linked` sin diferencias.
- `supabase/migraciones_historicas/` (001–025) es solo referencia; no se ejecuta.
- Todo cambio de estructura va en una migración nueva: `supabase migration new nombre` → `supabase db push --dry-run` → `supabase db push`. **No** ejecutar DDL en el SQL Editor (desincroniza el historial).
- La base revoca los privilegios por defecto, incluso a `service_role`: cada tabla o función nueva necesita su `GRANT` explícito.
- Migraciones re-ejecutables: `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`, `ON CONFLICT`.

## 59. Soporte TI y Edge Functions

- Usuarios internos: módulo `SupportModule` (vistas usuarios, roles, auditoría, configuración).
- Crear cuentas y asignar contraseñas temporales: Edge Function `gestionar-usuarios` (usa la service_role en el servidor y valida rol `soporte_ti`). Desplegar con `supabase functions deploy gestionar-usuarios --use-api`.
- Nombre, rol y estado: RPC `actualizar_usuario_interno()`. Auditoría: `auditoria_usuarios` + `auditoria_sistema()`.
- El personal cambia su contraseña desde "Cambiar contraseña" en la barra lateral.
