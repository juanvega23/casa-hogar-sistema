-- =========================================================
-- DATOS · DEPARTAMENTOS DE LA FERRETERÍA Y SUS PRODUCTOS
--
-- Script de datos (no de estructura): se ejecuta una vez en el
-- SQL Editor de Supabase. No es una migración porque no cambia
-- tablas, funciones ni políticas.
--
-- 1. Crea las categorías que faltan junto a "Herramientas".
-- 2. Agrega productos reales a cada categoría con precio de
--    compra, precio de venta y stock inicial.
--
-- El stock inicial entra con un movimiento 'entrada' trazable
-- (motivo "Inventario inicial"), igual que exige el kardex.
--
-- Algunos productos llevan descuento (precio tachado en la tienda)
-- y otros arrancan con existencia igual o menor al stock mínimo
-- ("Últimas unidades").
--
-- Precios en córdobas, aproximados a ferreterías de Managua
-- (octubre 2026). Ajustarlos después desde Compras → Productos.
--
-- Re-ejecutable: las categorías y productos que ya existen
-- (mismo nombre, sin distinguir mayúsculas) se omiten.
--
-- Tablas afectadas: categorias, productos, existencias,
-- movimientos_inventario.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. CATEGORÍAS
-- ---------------------------------------------------------

INSERT INTO public.categorias (nombre, descripcion)
SELECT v.nombre, v.descripcion
FROM (
  VALUES
    ('Construcción / Albañilería', 'Cemento, bloques, varillas, cal y herramientas de albañil.'),
    ('Plomería / Fontanería', 'Tubería PVC, accesorios, llaves de paso y selladores.'),
    ('Electricidad', 'Cable, tomacorrientes, apagadores, iluminación y cinta aislante.'),
    ('Pinturas', 'Pinturas, brochas, rodillos y solventes.'),
    ('Carpintería', 'Madera, clavos, bisagras, pegamentos y herramientas de corte.'),
    ('Abrasivos', 'Discos de corte y desbaste, lijas y cepillos de alambre.'),
    ('Hogar y accesorios', 'Grifería, limpieza, jardín y seguridad para el hogar.')
) AS v (nombre, descripcion)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.categorias c
  WHERE lower(c.nombre) = lower(v.nombre)
);

-- ---------------------------------------------------------
-- 2. PRODUCTOS
-- ---------------------------------------------------------

CREATE TEMP TABLE tmp_productos (
  orden int,
  categoria text,
  nombre text,
  descripcion text,
  unidad text,          -- nombre en unidades_medida
  precio_compra numeric,
  precio_venta numeric,
  descuento numeric,
  stock_minimo numeric,
  stock_maximo numeric,
  stock_inicial numeric
) ON COMMIT DROP;

INSERT INTO tmp_productos VALUES
  -- Herramientas (ya existe; la llave ajustable 10" ya está creada)
  (1,  'Herramientas', 'Martillo de uña 16 oz', 'Martillo de uña curva con cabeza de acero forjado y mango de fibra de vidrio antivibración.',
       'unidad', 190, 270, 0, 5, 30, 15),
  (2,  'Herramientas', 'Juego de destornilladores 6 piezas', 'Tres planos y tres Phillips con punta imantada y mango ergonómico.',
       'unidad', 210, 310, 10, 4, 25, 12),
  (3,  'Herramientas', 'Taladro percutor 1/2" 650 W', 'Taladro percutor con mandril de 1/2", velocidad variable y reversa. Incluye mango auxiliar.',
       'unidad', 1850, 2450, 0, 2, 10, 6),
  (4,  'Herramientas', 'Cinta métrica 5 m', 'Cinta métrica de 5 m con freno y carcasa engomada. Escala en metros y pulgadas.',
       'unidad', 125, 180, 0, 6, 40, 20),

  -- Construcción / Albañilería
  (10, 'Construcción / Albañilería', 'Cemento gris 42.5 kg', 'Cemento de uso general para concreto, repello y pegado de bloques. Bolsa de 42.5 kg.',
       'unidad', 330, 380, 0, 20, 200, 70),
  (11, 'Construcción / Albañilería', 'Bloque de concreto 15 x 20 x 40 cm', 'Bloque de concreto para paredes de carga y divisiones.',
       'unidad', 22, 30, 0, 100, 2000, 600),
  (12, 'Construcción / Albañilería', 'Varilla corrugada 3/8" x 6 m', 'Varilla de acero corrugada grado 40 de 3/8" para refuerzo de concreto.',
       'unidad', 90, 115, 0, 20, 200, 90),
  (13, 'Construcción / Albañilería', 'Cal hidratada 25 kg', 'Cal hidratada para mezclas de repello y fino. Bolsa de 25 kg.',
       'unidad', 170, 220, 0, 10, 80, 30),
  (14, 'Construcción / Albañilería', 'Llana lisa de acero 11"', 'Llana de acero templado con mango de madera para repello y afinado.',
       'unidad', 120, 175, 0, 5, 30, 4),

  -- Plomería / Fontanería
  (20, 'Plomería / Fontanería', 'Tubo PVC 1/2" SDR 13.5 x 6 m', 'Tubo PVC para agua potable a presión, 1/2" de diámetro y 6 metros de largo.',
       'unidad', 115, 165, 0, 10, 80, 40),
  (21, 'Plomería / Fontanería', 'Codo PVC 1/2" x 90°', 'Codo liso de PVC para tubería de agua potable de 1/2".',
       'unidad', 6, 10, 0, 50, 500, 200),
  (22, 'Plomería / Fontanería', 'Cemento solvente para PVC 118 ml', 'Pegamento para unir tubería y accesorios de PVC. Frasco con aplicador.',
       'unidad', 85, 125, 0, 10, 60, 25),
  (23, 'Plomería / Fontanería', 'Cinta teflón 1/2" x 10 m', 'Cinta selladora de PTFE para roscas de tubería y accesorios.',
       'unidad', 12, 20, 0, 30, 300, 120),
  (24, 'Plomería / Fontanería', 'Llave de paso 1/2" de bronce', 'Llave de paso de bronce con rosca hembra para control de agua.',
       'unidad', 160, 230, 0, 5, 40, 3),

  -- Electricidad
  (30, 'Electricidad', 'Cable THHN calibre 12 (por metro)', 'Cable de cobre THHN/THWN calibre 12 AWG para instalaciones residenciales. Se vende por metro.',
       'metro', 19, 28, 0, 50, 500, 300),
  (31, 'Electricidad', 'Tomacorriente doble polarizado', 'Tomacorriente doble de 15 A y 125 V con placa blanca.',
       'unidad', 45, 70, 0, 15, 120, 50),
  (32, 'Electricidad', 'Apagador sencillo', 'Interruptor sencillo de 15 A con placa blanca para empotrar.',
       'unidad', 35, 55, 0, 15, 120, 50),
  (33, 'Electricidad', 'Bombillo LED 9 W luz blanca', 'Bombillo LED rosca E27, equivale a 60 W incandescente. Luz blanca 6500 K.',
       'unidad', 48, 75, 10, 20, 150, 80),
  (34, 'Electricidad', 'Cinta aislante negra 19 mm x 18 m', 'Cinta aislante de vinil para empalmes eléctricos, resistente a la humedad.',
       'unidad', 38, 60, 0, 20, 150, 60),

  -- Pinturas
  (40, 'Pinturas', 'Pintura acrílica de agua blanca (galón)', 'Pintura látex acrílica para interiores y exteriores, acabado mate. Rinde hasta 35 m² por mano.',
       'unidad', 380, 520, 10, 6, 40, 20),
  (41, 'Pinturas', 'Esmalte anticorrosivo gris (galón)', 'Esmalte alquídico para proteger estructuras de hierro contra el óxido.',
       'unidad', 520, 690, 0, 4, 25, 10),
  (42, 'Pinturas', 'Brocha de 3"', 'Brocha de cerda natural con mango de madera para pintura de agua y aceite.',
       'unidad', 55, 85, 0, 10, 80, 30),
  (43, 'Pinturas', 'Rodillo de 9" con bandeja', 'Rodillo de felpa antigoteo con marco metálico y bandeja plástica.',
       'unidad', 160, 230, 15, 5, 30, 12),
  (44, 'Pinturas', 'Thinner corriente (litro)', 'Solvente para diluir esmaltes y limpiar brochas. Se vende por litro.',
       'litro', 65, 95, 0, 10, 80, 30),

  -- Carpintería
  (50, 'Carpintería', 'Plywood 4 x 8 pies de 12 mm', 'Lámina de plywood de pino de 12 mm para muebles, divisiones y formaleta.',
       'unidad', 780, 980, 0, 5, 40, 15),
  (51, 'Carpintería', 'Clavo de hierro 2 1/2" (por kg)', 'Clavo corriente con cabeza de 2 1/2" para madera y formaletas. Se vende por kilogramo.',
       'kilogramo', 52, 75, 0, 10, 100, 45),
  (52, 'Carpintería', 'Serrucho de 20"', 'Serrucho con dientes templados para corte de madera y mango plástico.',
       'unidad', 230, 320, 0, 4, 25, 10),
  (53, 'Carpintería', 'Bisagra de acero 3" (par)', 'Par de bisagras de acero para puertas y muebles, con tornillos.',
       'unidad', 40, 60, 0, 10, 100, 40),
  (54, 'Carpintería', 'Pegamento blanco para madera 250 g', 'Cola blanca de secado rápido para ensambles de madera.',
       'unidad', 60, 90, 0, 8, 60, 6),

  -- Abrasivos
  (60, 'Abrasivos', 'Disco de corte para metal 4 1/2"', 'Disco abrasivo delgado de 4 1/2" x 1 mm para esmeriladora angular.',
       'unidad', 35, 55, 0, 20, 150, 60),
  (61, 'Abrasivos', 'Disco de desbaste 4 1/2"', 'Disco de desbaste para metal de 4 1/2" x 6 mm para esmeriladora angular.',
       'unidad', 55, 85, 0, 15, 100, 40),
  (62, 'Abrasivos', 'Lija de agua #120 (pliego)', 'Pliego de lija impermeable grano 120 para metal y pintura.',
       'unidad', 12, 20, 0, 30, 300, 100),
  (63, 'Abrasivos', 'Lija para madera #80 (pliego)', 'Pliego de lija grano 80 para desbaste de madera.',
       'unidad', 12, 20, 0, 30, 300, 100),
  (64, 'Abrasivos', 'Cepillo de alambre tipo copa 3"', 'Copa de alambre trenzado para esmeriladora, quita óxido y pintura vieja.',
       'unidad', 110, 160, 10, 5, 30, 10),

  -- Hogar y accesorios
  (70, 'Hogar y accesorios', 'Llave para lavamanos cromada', 'Llave individual para lavamanos de 1/2", acabado cromado.',
       'unidad', 270, 380, 0, 4, 30, 10),
  (71, 'Hogar y accesorios', 'Candado de latón 40 mm', 'Candado de latón sólido con arco de acero endurecido y 3 llaves.',
       'unidad', 160, 230, 0, 4, 30, 4),
  (72, 'Hogar y accesorios', 'Escoba de nylon con palo', 'Escoba de cerdas de nylon para interiores, con palo de madera forrado.',
       'unidad', 80, 120, 0, 6, 40, 20),
  (73, 'Hogar y accesorios', 'Manguera de jardín 1/2" x 15 m', 'Manguera reforzada de PVC flexible con acoples de rosca.',
       'unidad', 350, 480, 10, 4, 30, 12),
  (74, 'Hogar y accesorios', 'Extensión eléctrica 3 m', 'Extensión de uso doméstico de 3 m con tres tomas y cable calibre 16.',
       'unidad', 120, 175, 0, 6, 40, 15);

DO $$
DECLARE
  v_prod record;
  v_categoria_id bigint;
  v_unidad_id bigint;
  v_unidad_nombre text;
  v_producto_id bigint;
  v_numero int;
  v_codigo text;
BEGIN
  SELECT coalesce(max(substring(codigo FROM '^PROD-(\d+)$')::int), 0)
  INTO v_numero
  FROM public.productos;

  FOR v_prod IN
    SELECT * FROM tmp_productos ORDER BY orden
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.productos p WHERE lower(p.nombre) = lower(v_prod.nombre)
    ) THEN
      RAISE NOTICE 'Se omite %: ya existe.', v_prod.nombre;
      CONTINUE;
    END IF;

    SELECT c.id
    INTO v_categoria_id
    FROM public.categorias c
    WHERE lower(c.nombre) = lower(v_prod.categoria);

    IF NOT FOUND THEN
      RAISE NOTICE 'Se omite %: no existe la categoría "%".', v_prod.nombre, v_prod.categoria;
      CONTINUE;
    END IF;

    -- Igual que el módulo de productos: id de la unidad y su nombre tal cual.
    SELECT um.id, um.nombre
    INTO v_unidad_id, v_unidad_nombre
    FROM public.unidades_medida um
    WHERE lower(um.nombre) = v_prod.unidad
    ORDER BY um.activo DESC
    LIMIT 1;

    IF NOT FOUND THEN
      v_unidad_nombre := v_prod.unidad;
    END IF;

    v_numero := v_numero + 1;
    v_codigo := 'PROD-' || lpad(v_numero::text, 3, '0');

    INSERT INTO public.productos (
      codigo, nombre, descripcion, categoria_id,
      unidad_medida, unidad_medida_id,
      precio_compra, precio_venta, descuento_porcentaje,
      stock_minimo, stock_maximo
    )
    VALUES (
      v_codigo, v_prod.nombre, v_prod.descripcion, v_categoria_id,
      v_unidad_nombre, v_unidad_id,
      v_prod.precio_compra, v_prod.precio_venta, v_prod.descuento,
      v_prod.stock_minimo, v_prod.stock_maximo
    )
    RETURNING id INTO v_producto_id;

    -- El trigger productos_crear_existencia ya dejó la fila en 0.
    INSERT INTO public.existencias (producto_id, cantidad)
    VALUES (v_producto_id, 0)
    ON CONFLICT (producto_id) DO NOTHING;

    IF v_prod.stock_inicial > 0 THEN
      UPDATE public.existencias
      SET cantidad = v_prod.stock_inicial
      WHERE producto_id = v_producto_id;

      INSERT INTO public.movimientos_inventario (
        producto_id, tipo, cantidad,
        cantidad_anterior, cantidad_nueva,
        motivo, referencia
      )
      VALUES (
        v_producto_id, 'entrada', v_prod.stock_inicial,
        0, v_prod.stock_inicial,
        'Inventario inicial', 'CARGA-INICIAL'
      );
    END IF;

    RAISE NOTICE 'Creado % · % en "%" a C$ %.',
      v_codigo, v_prod.nombre, v_prod.categoria, v_prod.precio_venta;
  END LOOP;
END;
$$;

COMMIT;

-- Resultado: cada categoría con sus productos reales.
SELECT
  c.nombre AS categoria,
  p.codigo,
  p.nombre AS producto,
  p.unidad_medida,
  p.precio_compra,
  p.precio_venta,
  p.descuento_porcentaje,
  e.cantidad AS existencia
FROM public.categorias c
LEFT JOIN public.productos p
  ON p.categoria_id = c.id
 AND p.activo
 AND p.nombre NOT ILIKE '%de prueba%'
LEFT JOIN public.existencias e ON e.producto_id = p.id
WHERE c.activo
ORDER BY c.nombre, p.codigo;
