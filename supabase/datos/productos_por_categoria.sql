-- =========================================================
-- DATOS · UN PRODUCTO REAL POR CATEGORÍA
--
-- Script de datos (no de estructura): se ejecuta una vez en el
-- SQL Editor de Supabase. No es una migración porque no cambia
-- tablas, funciones ni políticas.
--
-- Para cada categoría activa que todavía no tiene un producto
-- real (los "de prueba" no cuentan), crea uno acorde a su nombre
-- con precio de compra, precio de venta y stock inicial.
--
-- El stock inicial entra con un movimiento 'entrada' trazable
-- (motivo "Inventario inicial"), igual que exige el kardex.
--
-- Precios en córdobas, aproximados a ferreterías de Managua
-- (octubre 2026). Ajustarlos después desde Compras → Productos.
--
-- Re-ejecutable: si la categoría ya tiene un producto real o el
-- nombre ya existe, se omite.
--
-- Tablas afectadas: productos, existencias, movimientos_inventario.
-- =========================================================

BEGIN;

CREATE TEMP TABLE tmp_candidatos (
  prioridad int,
  patron text,          -- expresión sobre el nombre de la categoría (minúsculas, sin tildes)
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

INSERT INTO tmp_candidatos VALUES
  (1,  '(herramienta|equipo).*(electric|inalambric)|electroportatil|maquinaria',
       'Taladro percutor 1/2" 650 W', 'Taladro percutor con mandril de 1/2", velocidad variable y reversa. Incluye mango auxiliar.',
       'unidad', 1850, 2450, 0, 2, 10, 6),
  (2,  'herramienta',
       'Llave ajustable 10"', 'Llave ajustable (perico) de acero cromo vanadio, apertura de hasta 30 mm.',
       'unidad', 205, 290, 0, 5, 30, 18),
  (3,  'ilumina|bombill|lampar|foco',
       'Bombillo LED 9 W luz blanca', 'Bombillo LED rosca E27, equivale a 60 W incandescente. Luz blanca 6500 K.',
       'unidad', 48, 75, 10, 20, 150, 80),
  (4,  'electric',
       'Cable THHN calibre 12 (por metro)', 'Cable de cobre THHN/THWN calibre 12 AWG para instalaciones residenciales. Se vende por metro.',
       'metro', 19, 28, 0, 50, 500, 300),
  (5,  'plomer|fontaner|tuber|sanitari|pvc',
       'Tubo PVC 1/2" SDR 13.5 x 6 m', 'Tubo PVC para agua potable a presión, 1/2" de diámetro y 6 metros de largo.',
       'unidad', 115, 165, 0, 10, 80, 40),
  (6,  'pintur|barniz|esmalte',
       'Pintura acrílica de agua blanca (galón)', 'Pintura látex acrílica para interiores y exteriores, acabado mate. Rinde hasta 35 m² por mano.',
       'unidad', 380, 520, 10, 6, 40, 20),
  (7,  'techo|zinc|lamina|cubierta',
       'Lámina de zinc ondulada cal. 26 x 12 pies', 'Lámina de zinc galvanizado ondulada, calibre 26, 12 pies de largo.',
       'unidad', 420, 520, 0, 10, 100, 45),
  (8,  'hierro|varilla|acero|metal',
       'Varilla corrugada 3/8" x 6 m', 'Varilla de acero corrugada grado 40 de 3/8" para refuerzo de concreto.',
       'unidad', 90, 115, 0, 20, 200, 90),
  (9,  'construc|cemento|obra gris|agregad|material',
       'Cemento gris Canal 42.5 kg', 'Cemento de uso general para concreto, repello y pegado de bloques. Bolsa de 42.5 kg.',
       'unidad', 330, 380, 0, 20, 200, 70),
  (10, 'torniller|fijac|clavo|perno|sujec',
       'Clavo de hierro 2 1/2" (por kg)', 'Clavo corriente con cabeza de 2 1/2" para madera y formaletas. Se vende por kilogramo.',
       'kilogramo', 52, 75, 0, 10, 100, 45),
  (11, 'jardin|riego',
       'Manguera de jardín 1/2" x 15 m', 'Manguera reforzada de PVC flexible con acoples de rosca.',
       'unidad', 350, 480, 0, 4, 30, 12),
  (12, 'segur|protec|epp|industrial',
       'Guantes de trabajo de cuero (par)', 'Guantes de carnaza con puño de tela, para carga y trabajo pesado.',
       'unidad', 95, 140, 0, 10, 80, 35),
  (13, 'cerrajer|candado|cerradur|herraje',
       'Candado de latón 40 mm', 'Candado de latón sólido con arco de acero endurecido y 3 llaves.',
       'unidad', 160, 230, 0, 4, 30, 4),
  (14, 'adhesiv|pegament|sellador|silicon',
       'Silicón transparente multiuso 280 ml', 'Sellador de silicón acético para vidrio, baños y cocinas. Cartucho de 280 ml.',
       'unidad', 100, 145, 0, 10, 80, 30),
  (15, 'limpie|aseo',
       'Escoba de nylon con palo', 'Escoba de cerdas de nylon para interiores, con palo de madera forrado.',
       'unidad', 80, 120, 0, 6, 40, 20),
  (16, 'medic|medir',
       'Cinta métrica 5 m', 'Cinta métrica de 5 m con freno y carcasa engomada. Escala en metros y pulgadas.',
       'unidad', 125, 180, 0, 6, 40, 20),
  (17, 'sold',
       'Electrodo 6013 de 1/8" (por kg)', 'Electrodo para soldadura de acero dulce en toda posición. Se vende por kilogramo.',
       'kilogramo', 120, 165, 0, 5, 50, 20),
  (18, 'abrasiv|lija|disco',
       'Disco de corte para metal 4 1/2"', 'Disco abrasivo delgado de 4 1/2" x 1 mm para esmeriladora angular.',
       'unidad', 35, 55, 0, 20, 150, 60),
  (19, 'madera|plywood|tabla',
       'Plywood 4 x 8 pies de 12 mm', 'Lámina de plywood de pino de 12 mm para muebles, divisiones y formaleta.',
       'unidad', 780, 980, 0, 5, 40, 15),
  (20, 'automo|vehic|taller',
       'Gato hidráulico de botella 2 t', 'Gato hidráulico tipo botella con capacidad de 2 toneladas.',
       'unidad', 780, 1050, 0, 2, 15, 6),
  (21, 'agric|agro|campo',
       'Machete 22" con cacha', 'Machete de acero al carbono de 22" con cacha plástica remachada.',
       'unidad', 175, 250, 0, 6, 40, 18),
  (22, 'bano|cocina|hogar|grifer',
       'Llave para lavamanos cromada', 'Llave individual para lavamanos de 1/2", acabado cromado.',
       'unidad', 270, 380, 0, 4, 30, 10),
  (23, 'general|ferreter|vario|otro|miscel',
       'Cinta aislante negra 19 mm x 18 m', 'Cinta aislante de vinil para empalmes eléctricos, resistente a la humedad.',
       'unidad', 38, 60, 0, 20, 150, 60);

DO $$
DECLARE
  v_cat record;
  v_prod record;
  v_unidad_id bigint;
  v_producto_id bigint;
  v_numero int;
  v_codigo text;
BEGIN
  SELECT coalesce(max(substring(codigo FROM '^PROD-(\d+)$')::int), 0)
  INTO v_numero
  FROM public.productos;

  FOR v_cat IN
    SELECT
      c.id,
      c.nombre,
      lower(translate(c.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS clave
    FROM public.categorias c
    WHERE c.activo
    ORDER BY c.nombre
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.productos p
      WHERE p.categoria_id = v_cat.id
        AND p.activo
        AND p.nombre NOT ILIKE '%de prueba%'
    ) THEN
      RAISE NOTICE 'Se omite "%": ya tiene productos reales.', v_cat.nombre;
      CONTINUE;
    END IF;

    SELECT *
    INTO v_prod
    FROM tmp_candidatos t
    WHERE v_cat.clave ~ t.patron
    ORDER BY t.prioridad
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'Sin producto sugerido para "%": agréguelo manualmente.', v_cat.nombre;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.productos p WHERE lower(p.nombre) = lower(v_prod.nombre)
    ) THEN
      RAISE NOTICE 'Se omite "%": ya existe %.', v_cat.nombre, v_prod.nombre;
      CONTINUE;
    END IF;

    SELECT um.id
    INTO v_unidad_id
    FROM public.unidades_medida um
    WHERE lower(um.nombre) = v_prod.unidad
    ORDER BY um.activo DESC
    LIMIT 1;

    v_numero := v_numero + 1;
    v_codigo := 'PROD-' || lpad(v_numero::text, 3, '0');

    INSERT INTO public.productos (
      codigo, nombre, descripcion, categoria_id,
      unidad_medida, unidad_medida_id,
      precio_compra, precio_venta, descuento_porcentaje,
      stock_minimo, stock_maximo
    )
    VALUES (
      v_codigo, v_prod.nombre, v_prod.descripcion, v_cat.id,
      v_prod.unidad, v_unidad_id,
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
      v_codigo, v_prod.nombre, v_cat.nombre, v_prod.precio_venta;
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
