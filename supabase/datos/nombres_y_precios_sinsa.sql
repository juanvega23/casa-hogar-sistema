-- =========================================================
-- DATOS · NOMBRES Y PRECIOS SEGÚN EL MERCADO NICARAGÜENSE
--
-- Script de datos (no de estructura): se ejecuta una vez en el
-- SQL Editor de Supabase o con `supabase db query --linked -f`.
--
-- Ajusta los productos de carga inicial (PROD-004 a PROD-043):
--   · Nombres con los términos que usa SINSA, la cadena de
--     ferreterías más grande de Nicaragua (crecen, desarmador,
--     interruptor, cinta de aislar, válvula de paso, látex…),
--     escritos de forma legible y SIN marcas reales.
--   · Precios de venta cercanos a los de SINSA (catálogo público
--     consultado el 28/10/2026), algo por debajo porque son
--     productos sin marca. El precio de compra deja un margen
--     de 25–35 %.
--
-- No toca los productos "de prueba" ni la existencia.
-- Las ventas y pedidos ya registrados guardan su propio precio
-- por línea, así que no cambian.
--
-- Re-ejecutable: actualiza por código y deja igual lo que ya
-- tiene esos valores.
--
-- Tabla afectada: productos (nombre, descripcion, precio_compra,
-- precio_venta, descuento_porcentaje).
-- =========================================================

BEGIN;

UPDATE public.productos p
SET
  nombre = v.nombre,
  descripcion = coalesce(v.descripcion, p.descripcion),
  precio_compra = v.precio_compra,
  precio_venta = v.precio_venta,
  descuento_porcentaje = v.descuento
FROM (
  VALUES
    -- Herramientas
    ('PROD-004', 'Llave crecen ajustable 10"', 'Llave crecen (ajustable) de acero cromo vanadio, apertura de hasta 30 mm.', 150, 210, 0),
    ('PROD-005', 'Martillo de uña 16 oz mango de fibra', NULL, 260, 350, 0),
    ('PROD-006', 'Juego de desarmadores 6 piezas', 'Tres desarmadores planos y tres Phillips con punta imantada y mango ergonómico.', 280, 380, 10),
    ('PROD-007', 'Taladro percutor 1/2" 650 W', NULL, 1750, 2350, 0),
    ('PROD-008', 'Cinta métrica 5 m', NULL, 85, 120, 0),

    -- Construcción / Albañilería
    ('PROD-009', 'Cemento gris 42.5 kg', NULL, 440, 515, 0),
    ('PROD-010', 'Bloque de concreto 15 x 20 x 40 cm', NULL, 24, 32, 0),
    ('PROD-011', 'Varilla corrugada 3/8" x 6 m', NULL, 200, 260, 0),
    ('PROD-012', 'Cal hidratada 25 kg', NULL, 175, 230, 0),
    ('PROD-013', 'Llana lisa de acero 11" x 5"', NULL, 135, 185, 0),

    -- Plomería / Fontanería
    ('PROD-014', 'Tubo PVC 1/2" SDR 13.5 x 6 m', NULL, 125, 170, 0),
    ('PROD-015', 'Codo PVC 1/2" x 90°', NULL, 8, 12, 0),
    ('PROD-016', 'Pegamento para PVC 4 oz', 'Pegamento (cemento solvente) para unir tubería y accesorios de PVC. Frasco con aplicador.', 160, 210, 0),
    ('PROD-017', 'Cinta teflón 1/2" x 12 m', NULL, 15, 22, 0),
    ('PROD-018', 'Válvula de paso 1/2" de bronce', 'Válvula de paso de bronce con rosca hembra para controlar el agua.', 330, 430, 0),

    -- Electricidad
    ('PROD-019', 'Cable THHN calibre 12 (por metro)', NULL, 27, 36, 0),
    ('PROD-020', 'Tomacorriente doble polarizado 15 A', NULL, 85, 120, 0),
    ('PROD-021', 'Interruptor sencillo 15 A', 'Interruptor sencillo de 15 A y 120 V con placa blanca para empotrar.', 45, 65, 0),
    ('PROD-022', 'Bombillo LED 9 W luz blanca', NULL, 50, 75, 10),
    ('PROD-023', 'Cinta de aislar negra 19 mm x 18 m', 'Cinta de aislar de vinil para empalmes eléctricos, resistente a la humedad.', 50, 75, 0),

    -- Pinturas
    ('PROD-024', 'Pintura látex blanca mate (galón)', 'Pintura látex para interiores y exteriores, acabado mate. Rinde hasta 35 m² por mano.', 340, 450, 10),
    ('PROD-025', 'Anticorrosivo gris mate (galón)', 'Pintura anticorrosiva para proteger estructuras de hierro contra el óxido.', 760, 980, 0),
    ('PROD-026', 'Brocha de 3"', NULL, 155, 210, 0),
    ('PROD-027', 'Rodillo para felpa 9" con bandeja', 'Rodillo con felpa antigoteo de 9", marco metálico y bandeja plástica.', 210, 290, 15),
    ('PROD-028', 'Thinner acrílico (litro)', 'Thinner acrílico para diluir pinturas y limpiar brochas. Se vende por litro.', 145, 195, 0),

    -- Carpintería
    ('PROD-029', 'Plywood 4 x 8 pies de 12 mm', NULL, 920, 1150, 0),
    ('PROD-030', 'Clavo corriente 2-1/2" para madera (por kg)', 'Clavo corriente con cabeza de 2-1/2" para madera y formaletas. Se vende por kilogramo.', 60, 85, 0),
    ('PROD-031', 'Serrucho de 20" para madera', NULL, 240, 330, 0),
    ('PROD-032', 'Bisagra de acero 3" (par)', NULL, 60, 85, 0),
    ('PROD-033', 'Pegamento blanco para madera 250 g', NULL, 70, 95, 0),

    -- Abrasivos
    ('PROD-034', 'Disco de corte para metal 4-1/2"', 'Disco abrasivo delgado de 4-1/2" x 1 mm para esmeriladora angular.', 40, 60, 0),
    ('PROD-035', 'Disco de desbaste 4-1/2" x 1/4"', 'Disco de desbaste para metal de 4-1/2" x 1/4" para esmeriladora angular.', 58, 80, 0),
    ('PROD-036', 'Lija de agua N° 120 (pliego)', 'Pliego de lija de agua grano 120 para metal y pintura.', 17, 25, 0),
    ('PROD-037', 'Lija para madera N° 80 (pliego)', 'Pliego de lija para madera grano 80 para desbaste.', 19, 28, 0),
    ('PROD-038', 'Cepillo de alambre tipo copa 3"', NULL, 85, 120, 10),

    -- Hogar y accesorios
    ('PROD-039', 'Llave para lavamanos cromada', NULL, 520, 690, 0),
    ('PROD-040', 'Candado de bronce 40 mm', 'Candado de bronce sólido con arco de acero endurecido y 3 llaves.', 260, 350, 0),
    ('PROD-041', 'Escoba de nylon con palo de madera', NULL, 120, 165, 0),
    ('PROD-042', 'Manguera de jardín 1/2" x 15 m', NULL, 390, 520, 10),
    ('PROD-043', 'Extensión eléctrica 9 pies 16/2', 'Extensión de uso doméstico de 9 pies (2.7 m) con tres tomas y cable calibre 16.', 165, 230, 0)
) AS v (codigo, nombre, descripcion, precio_compra, precio_venta, descuento)
WHERE p.codigo = v.codigo;

COMMIT;

-- Resultado: nombre y precios finales.
SELECT
  p.codigo,
  p.nombre,
  p.precio_compra,
  p.precio_venta,
  p.descuento_porcentaje,
  round((p.precio_venta - p.precio_compra) / p.precio_venta * 100) AS margen_pct
FROM public.productos p
WHERE p.codigo BETWEEN 'PROD-004' AND 'PROD-043'
ORDER BY p.codigo;
