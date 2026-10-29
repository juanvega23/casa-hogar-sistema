import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'


// ==========================================================
// PROPS
// ==========================================================

type ProductsModuleProps = {
  roleCode: string
}


// ==========================================================
// CATÁLOGOS
// ==========================================================

type Catalogo = {
  id: number
  nombre: string
}

type CatalogoRelacion = {
  nombre: string
}


// ==========================================================
// EXISTENCIAS
// ==========================================================

type ExistenciaRelacion = {
  cantidad: number | string
}


// ==========================================================
// RESPUESTA DE PRODUCTOS
// ==========================================================

type ProductoRespuesta = {
  id: number
  codigo: string
  nombre: string
  descripcion: string | null

  categoria_id: number

  marca_id: number | null
  modelo_id: number | null
  color_id: number | null
  material_id: number | null
  unidad_medida_id: number | null

  unidad_medida: string

  precio_compra: number | string
  precio_venta: number | string
  stock_minimo: number | string
  stock_maximo: number | string | null

  activo: boolean

  imagen_url: string | null

  categorias:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null

  marcas:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null

  modelos:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null

  colores:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null

  materiales:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null

  unidades_medida:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null

  existencias:
    | ExistenciaRelacion
    | ExistenciaRelacion[]
    | null
}


// ==========================================================
// PRODUCTO PARA LA INTERFAZ
// ==========================================================

type Producto = {
  id: number
  codigo: string
  nombre: string
  descripcion: string

  categoriaId: number
  categoria: string

  marcaId: number | null
  marca: string

  modeloId: number | null
  modelo: string

  colorId: number | null
  color: string

  materialId: number | null
  material: string

  unidadMedidaId: number | null
  unidad: string

  precioCompra: number
  precioVenta: number

  stock: number
  stockMinimo: number
  stockMaximo: number | null

  imagenUrl: string | null
}


// ==========================================================
// FILTROS POR COLUMNA DE LA TABLA
// ==========================================================

type ColumnaFiltro =
  | 'categoria'
  | 'marca'
  | 'modelo'
  | 'color'
  | 'material'
  | 'unidad'

type EstadoExistencia =
  | ''
  | 'sin'
  | 'bajo'
  | 'normal'
  | 'sobre'

type FiltrosTabla =
  Record<ColumnaFiltro, string> & {
    existencia: EstadoExistencia
  }

const COLUMNAS_FILTRO: ColumnaFiltro[] = [
  'categoria',
  'marca',
  'modelo',
  'color',
  'material',
  'unidad',
]

// Título de la columna y primera opción de su menú
const TITULOS_FILTRO: Record<
  ColumnaFiltro,
  [string, string]
> = {
  categoria: ['Categoría', 'Todas las categorías'],
  marca: ['Marca', 'Todas las marcas'],
  modelo: ['Modelo', 'Todos los modelos'],
  color: ['Color', 'Todos los colores'],
  material: ['Material', 'Todos los materiales'],
  unidad: ['Unidad', 'Todas las unidades'],
}

const FILTROS_VACIOS: FiltrosTabla = {
  categoria: '',
  marca: '',
  modelo: '',
  color: '',
  material: '',
  unidad: '',
  existencia: '',
}

const ESTADOS_EXISTENCIA: {
  valor: EstadoExistencia
  etiqueta: string
}[] = [
  { valor: '', etiqueta: 'Cualquier existencia' },
  { valor: 'sin', etiqueta: 'Sin existencia' },
  { valor: 'bajo', etiqueta: 'En o bajo el mínimo' },
  { valor: 'normal', etiqueta: 'Normal' },
  { valor: 'sobre', etiqueta: 'Sobre el máximo' },
]


function estadoExistencia(
  producto: Producto,
): EstadoExistencia {
  if (producto.stock <= 0) {
    return 'sin'
  }

  if (producto.stock <= producto.stockMinimo) {
    return 'bajo'
  }

  if (
    producto.stockMaximo !== null &&
    producto.stock > producto.stockMaximo
  ) {
    return 'sobre'
  }

  return 'normal'
}


function IconoMenu() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  )
}


/*
 * Indica si el producto pasa la búsqueda general y los
 * filtros por columna. "omitir" deja fuera un filtro para
 * calcular las opciones de su propio menú desplegable.
 */
function cumpleFiltros(
  producto: Producto,
  termino: string,
  filtros: FiltrosTabla,
  omitir?: ColumnaFiltro,
) {
  if (termino) {
    const texto = [
      producto.codigo,
      producto.nombre,
      producto.categoria,
      producto.marca,
      producto.modelo,
      producto.color,
      producto.material,
      producto.unidad,
    ]
      .join(' ')
      .toLowerCase()

    if (!texto.includes(termino)) {
      return false
    }
  }

  for (const columna of COLUMNAS_FILTRO) {
    if (
      columna !== omitir &&
      filtros[columna] &&
      producto[columna] !== filtros[columna]
    ) {
      return false
    }
  }

  return (
    !filtros.existencia ||
    estadoExistencia(producto) === filtros.existencia
  )
}


// ==========================================================
// IMÁGENES (Supabase Storage · bucket 'productos')
// ==========================================================

const BUCKET_IMAGENES = 'productos'

const TIPOS_IMAGEN = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

const TAMANO_MAXIMO_IMAGEN =
  2 * 1024 * 1024


/*
 * Obtiene la ruta interna del archivo a partir de su URL
 * pública, para poder eliminar la imagen anterior.
 */
function rutaDesdeUrlPublica(
  url: string | null,
) {
  if (!url) {
    return null
  }

  const marcador =
    `/object/public/${BUCKET_IMAGENES}/`

  const indice =
    url.indexOf(marcador)

  return indice === -1
    ? null
    : decodeURIComponent(
        url.slice(
          indice + marcador.length,
        ),
      )
}


// ==========================================================
// FORMULARIO
// ==========================================================

type FormProducto = {
  codigo: string
  nombre: string
  descripcion: string

  categoriaId: string

  marcaId: string
  modeloId: string
  colorId: string
  materialId: string
  unidadMedidaId: string

  precioCompra: string
  precioVenta: string
  stockMinimo: string
  stockMaximo: string
}


const formularioInicial: FormProducto = {
  codigo: '',
  nombre: '',
  descripcion: '',

  categoriaId: '',

  marcaId: '',
  modeloId: '',
  colorId: '',
  materialId: '',
  unidadMedidaId: '',

  precioCompra: '',
  precioVenta: '',
  stockMinimo: '',
  stockMaximo: '',
}


// ==========================================================
// UTILIDADES
// ==========================================================

function obtenerNombreRelacion(
  relacion:
    | CatalogoRelacion
    | CatalogoRelacion[]
    | null,
  respaldo: string,
) {
  if (!relacion) {
    return respaldo
  }

  if (Array.isArray(relacion)) {
    return (
      relacion[0]?.nombre ??
      respaldo
    )
  }

  return (
    relacion.nombre ??
    respaldo
  )
}


function obtenerStock(
  relacion:
    | ExistenciaRelacion
    | ExistenciaRelacion[]
    | null,
) {
  if (!relacion) {
    return 0
  }

  if (Array.isArray(relacion)) {
    return Number(
      relacion[0]?.cantidad ??
        0,
    )
  }

  return Number(
    relacion.cantidad ??
      0,
  )
}


function formatearCordobas(
  valor: number,
) {
  return new Intl.NumberFormat(
    'es-NI',
    {
      style: 'currency',
      currency: 'NIO',
      minimumFractionDigits: 2,
    },
  ).format(valor)
}


function obtenerMensajeError(
  err: unknown,
  respaldo: string,
) {
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err
  ) {
    const mensaje =
      (
        err as {
          message?: unknown
        }
      ).message

    if (
      typeof mensaje ===
      'string'
    ) {
      return mensaje
    }
  }

  if (
    err instanceof Error
  ) {
    return err.message
  }

  return respaldo
}


// ==========================================================
// COMPONENTE
// ==========================================================

export default function ProductsModule({
  roleCode,
}: ProductsModuleProps) {
  /*
   * ÚNICAMENTE EL ENCARGADO DE COMPRAS
   * ADMINISTRA EL CATÁLOGO DE PRODUCTOS.
   */
  const puedeAdministrar =
    roleCode ===
    'encargado_compras'


  // ========================================================
  // ESTADOS PRINCIPALES
  // ========================================================

  const [
    productos,
    setProductos,
  ] =
    useState<
      Producto[]
    >([])


  const [
    categorias,
    setCategorias,
  ] =
    useState<
      Catalogo[]
    >([])


  const [
    marcas,
    setMarcas,
  ] =
    useState<
      Catalogo[]
    >([])


  const [
    modelos,
    setModelos,
  ] =
    useState<
      Catalogo[]
    >([])


  const [
    colores,
    setColores,
  ] =
    useState<
      Catalogo[]
    >([])


  const [
    materiales,
    setMateriales,
  ] =
    useState<
      Catalogo[]
    >([])


  const [
    unidadesMedida,
    setUnidadesMedida,
  ] =
    useState<
      Catalogo[]
    >([])


  const [
    busqueda,
    setBusqueda,
  ] =
    useState('')


  const [
    filtros,
    setFiltros,
  ] =
    useState<FiltrosTabla>(
      FILTROS_VACIOS,
    )


  const [
    cargando,
    setCargando,
  ] =
    useState(true)


  const [
    guardando,
    setGuardando,
  ] =
    useState(false)


  const [
    error,
    setError,
  ] =
    useState('')


  const [
    exito,
    setExito,
  ] =
    useState('')


  const [
    mostrarFormulario,
    setMostrarFormulario,
  ] =
    useState(false)


  const [
    productoEditando,
    setProductoEditando,
  ] =
    useState<
      number | null
    >(null)


  const [
    formulario,
    setFormulario,
  ] =
    useState<FormProducto>(
      formularioInicial,
    )


  // Imagen seleccionada en el formulario (se sube al guardar).
  const [
    archivoImagen,
    setArchivoImagen,
  ] =
    useState<File | null>(null)


  const [
    imagenActual,
    setImagenActual,
  ] =
    useState<string | null>(null)


  const [
    quitarImagen,
    setQuitarImagen,
  ] =
    useState(false)


  const vistaPreviaImagen =
    useMemo(
      () =>
        archivoImagen
          ? URL.createObjectURL(archivoImagen)
          : null,
      [archivoImagen],
    )


  useEffect(() => {
    return () => {
      if (vistaPreviaImagen) {
        URL.revokeObjectURL(vistaPreviaImagen)
      }
    }
  }, [vistaPreviaImagen])


  // ========================================================
  // CARGAR DATOS
  // ========================================================

  async function cargarDatos() {
    try {
      setCargando(true)

      setError('')


      const [
        productosResultado,
        categoriasResultado,
        marcasResultado,
        modelosResultado,
        coloresResultado,
        materialesResultado,
        unidadesResultado,
      ] =
        await Promise.all([

          // --------------------------------------------------
          // PRODUCTOS
          // --------------------------------------------------

          supabase
            .from(
              'productos',
            )
            .select(`
              id,
              codigo,
              nombre,
              descripcion,

              categoria_id,

              marca_id,
              modelo_id,
              color_id,
              material_id,
              unidad_medida_id,

              unidad_medida,

              precio_compra,
              precio_venta,
              stock_minimo,
              stock_maximo,
              activo,
              imagen_url,

              categorias (
                nombre
              ),

              marcas (
                nombre
              ),

              modelos (
                nombre
              ),

              colores (
                nombre
              ),

              materiales (
                nombre
              ),

              unidades_medida (
                nombre
              ),

              existencias (
                cantidad
              )
            `)
            .eq(
              'activo',
              true,
            )
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),


          // --------------------------------------------------
          // CATEGORÍAS
          // --------------------------------------------------

          supabase
            .from(
              'categorias',
            )
            .select(`
              id,
              nombre
            `)
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),


          // --------------------------------------------------
          // MARCAS
          // --------------------------------------------------

          supabase
            .from(
              'marcas',
            )
            .select(`
              id,
              nombre
            `)
            .eq(
              'activo',
              true,
            )
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),


          // --------------------------------------------------
          // MODELOS
          // --------------------------------------------------

          supabase
            .from(
              'modelos',
            )
            .select(`
              id,
              nombre
            `)
            .eq(
              'activo',
              true,
            )
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),


          // --------------------------------------------------
          // COLORES
          // --------------------------------------------------

          supabase
            .from(
              'colores',
            )
            .select(`
              id,
              nombre
            `)
            .eq(
              'activo',
              true,
            )
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),


          // --------------------------------------------------
          // MATERIALES
          // --------------------------------------------------

          supabase
            .from(
              'materiales',
            )
            .select(`
              id,
              nombre
            `)
            .eq(
              'activo',
              true,
            )
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),


          // --------------------------------------------------
          // UNIDADES
          // --------------------------------------------------

          supabase
            .from(
              'unidades_medida',
            )
            .select(`
              id,
              nombre
            `)
            .eq(
              'activo',
              true,
            )
            .order(
              'nombre',
              {
                ascending:
                  true,
              },
            ),
        ])


      // ======================================================
      // ERRORES
      // ======================================================

      if (
        productosResultado.error
      ) {
        throw new Error(
          `No fue posible cargar los productos: ${productosResultado.error.message}`,
        )
      }


      if (
        categoriasResultado.error
      ) {
        throw new Error(
          `No fue posible cargar las categorías: ${categoriasResultado.error.message}`,
        )
      }


      if (
        marcasResultado.error
      ) {
        throw new Error(
          `No fue posible cargar las marcas: ${marcasResultado.error.message}`,
        )
      }


      if (
        modelosResultado.error
      ) {
        throw new Error(
          `No fue posible cargar los modelos: ${modelosResultado.error.message}`,
        )
      }


      if (
        coloresResultado.error
      ) {
        throw new Error(
          `No fue posible cargar los colores: ${coloresResultado.error.message}`,
        )
      }


      if (
        materialesResultado.error
      ) {
        throw new Error(
          `No fue posible cargar los materiales: ${materialesResultado.error.message}`,
        )
      }


      if (
        unidadesResultado.error
      ) {
        throw new Error(
          `No fue posible cargar las unidades de medida: ${unidadesResultado.error.message}`,
        )
      }


      // ======================================================
      // TRANSFORMAR PRODUCTOS
      // ======================================================

      const respuesta =
        (
          productosResultado.data ??
          []
        ) as unknown as ProductoRespuesta[]


      const lista =
        respuesta.map(
          (
            producto,
          ): Producto => ({
            id:
              producto.id,

            codigo:
              producto.codigo,

            nombre:
              producto.nombre,

            descripcion:
              producto.descripcion ??
              '',


            categoriaId:
              producto.categoria_id,

            categoria:
              obtenerNombreRelacion(
                producto.categorias,
                'Sin categoría',
              ),


            marcaId:
              producto.marca_id,

            marca:
              obtenerNombreRelacion(
                producto.marcas,
                'Sin especificar',
              ),


            modeloId:
              producto.modelo_id,

            modelo:
              obtenerNombreRelacion(
                producto.modelos,
                'Sin especificar',
              ),


            colorId:
              producto.color_id,

            color:
              obtenerNombreRelacion(
                producto.colores,
                'Sin especificar',
              ),


            materialId:
              producto.material_id,

            material:
              obtenerNombreRelacion(
                producto.materiales,
                'Sin especificar',
              ),


            unidadMedidaId:
              producto.unidad_medida_id,

            unidad:
              obtenerNombreRelacion(
                producto.unidades_medida,
                producto.unidad_medida ||
                  'Sin especificar',
              ),


            precioCompra:
              Number(
                producto.precio_compra ??
                  0,
              ),

            precioVenta:
              Number(
                producto.precio_venta ??
                  0,
              ),


            stock:
              obtenerStock(
                producto.existencias,
              ),


            stockMinimo:
              Number(
                producto.stock_minimo ??
                  0,
              ),

            stockMaximo:
              producto.stock_maximo === null
                ? null
                : Number(
                    producto.stock_maximo,
                  ),

            imagenUrl:
              producto.imagen_url ??
              null,
          }),
        )


      setProductos(
        lista,
      )


      setCategorias(
        (
          categoriasResultado.data ??
          []
        ) as Catalogo[],
      )


      setMarcas(
        (
          marcasResultado.data ??
          []
        ) as Catalogo[],
      )


      setModelos(
        (
          modelosResultado.data ??
          []
        ) as Catalogo[],
      )


      setColores(
        (
          coloresResultado.data ??
          []
        ) as Catalogo[],
      )


      setMateriales(
        (
          materialesResultado.data ??
          []
        ) as Catalogo[],
      )


      setUnidadesMedida(
        (
          unidadesResultado.data ??
          []
        ) as Catalogo[],
      )
    } catch (err) {
      setProductos(
        [],
      )

      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar los productos.',
        ),
      )
    } finally {
      setCargando(
        false,
      )
    }
  }


  useEffect(() => {
    void cargarDatos()
  }, [])


  // ========================================================
  // FILTRAR PRODUCTOS
  // ========================================================

  const termino =
    busqueda
      .trim()
      .toLowerCase()


  const productosFiltrados =
    useMemo(() => {
      return productos.filter(
        producto =>
          cumpleFiltros(
            producto,
            termino,
            filtros,
          ),
      )
    }, [
      productos,
      termino,
      filtros,
    ])


  /*
   * Opciones de cada menú desplegable: solo los valores que
   * quedan con los demás filtros aplicados, para que se vayan
   * acotando entre sí.
   */
  const opcionesFiltro =
    useMemo(() => {
      const opciones = {} as Record<
        ColumnaFiltro,
        string[]
      >

      for (const columna of COLUMNAS_FILTRO) {
        const valores = new Set(
          productos
            .filter(producto =>
              cumpleFiltros(
                producto,
                termino,
                filtros,
                columna,
              ),
            )
            .map(producto => producto[columna]),
        )

        if (filtros[columna]) {
          valores.add(filtros[columna])
        }

        opciones[columna] = [...valores].sort(
          (a, b) => a.localeCompare(b, 'es'),
        )
      }

      return opciones
    }, [
      productos,
      termino,
      filtros,
    ])


  // Filtros elegidos, para mostrarlos como etiquetas que se quitan con un clic
  const filtrosActivos: {
    campo: keyof FiltrosTabla
    texto: string
  }[] = [
    ...COLUMNAS_FILTRO.filter(
      columna => filtros[columna],
    ).map(columna => ({
      campo: columna,
      texto: `${TITULOS_FILTRO[columna][0]}: ${filtros[columna]}`,
    })),
    ...(filtros.existencia
      ? [
          {
            campo: 'existencia' as const,
            texto: `Existencia: ${
              ESTADOS_EXISTENCIA.find(
                estado =>
                  estado.valor ===
                  filtros.existencia,
              )?.etiqueta
            }`,
          },
        ]
      : []),
  ]


  const hayFiltros =
    termino !== '' ||
    filtrosActivos.length > 0


  function cambiarFiltro(
    campo: keyof FiltrosTabla,
    valor: string,
  ) {
    setFiltros(actuales => ({
      ...actuales,
      [campo]: valor,
    }))
  }


  function limpiarFiltros() {
    setBusqueda('')
    setFiltros(FILTROS_VACIOS)
  }


  // ========================================================
  // RESUMEN
  // ========================================================

  const resumen =
    useMemo(() => {
      return {
        total:
          productos.length,

        categorias:
          new Set(
            productos.map(
              producto =>
                producto.categoria,
            ),
          ).size,

        conExistencia:
          productos.filter(
            producto =>
              producto.stock >
              0,
          ).length,

        sinExistencia:
          productos.filter(
            producto =>
              producto.stock <=
              0,
          ).length,
      }
    }, [
      productos,
    ])


  // ========================================================
  // ACTUALIZAR FORMULARIO
  // ========================================================

  function actualizarFormulario(
    campo:
      keyof FormProducto,
    valor: string,
  ) {
    setFormulario(
      actual => ({
        ...actual,
        [campo]:
          valor,
      }),
    )
  }


  // ========================================================
  // NUEVO PRODUCTO
  // ========================================================

  function abrirNuevoProducto() {
    if (
      !puedeAdministrar
    ) {
      setError(
        'Este perfil solamente puede consultar productos.',
      )

      return
    }


    const unidadPredeterminada =
      unidadesMedida.find(
        unidad =>
          unidad.nombre
            .trim()
            .toLowerCase() ===
          'unidad',
      ) ??
      unidadesMedida[0]


    setProductoEditando(
      null,
    )


    setFormulario({
      ...formularioInicial,

      categoriaId:
        categorias.length >
        0
          ? String(
              categorias[0].id,
            )
          : '',

      unidadMedidaId:
        unidadPredeterminada
          ? String(
              unidadPredeterminada.id,
            )
          : '',
    })


    setArchivoImagen(null)
    setImagenActual(null)
    setQuitarImagen(false)

    setError('')
    setExito('')

    setMostrarFormulario(
      true,
    )
  }


  // ========================================================
  // EDITAR PRODUCTO
  // ========================================================

  function abrirEditarProducto(
    producto: Producto,
  ) {
    if (
      !puedeAdministrar
    ) {
      setError(
        'Este perfil solamente puede consultar productos.',
      )

      return
    }


    let unidadId =
      producto.unidadMedidaId


    if (
      !unidadId
    ) {
      const unidadEncontrada =
        unidadesMedida.find(
          unidad =>
            unidad.nombre
              .trim()
              .toLowerCase() ===
            producto.unidad
              .trim()
              .toLowerCase(),
        )

      unidadId =
        unidadEncontrada?.id ??
        null
    }


    setProductoEditando(
      producto.id,
    )


    setFormulario({
      codigo:
        producto.codigo,

      nombre:
        producto.nombre,

      descripcion:
        producto.descripcion,

      categoriaId:
        String(
          producto.categoriaId,
        ),

      marcaId:
        producto.marcaId
          ? String(
              producto.marcaId,
            )
          : '',

      modeloId:
        producto.modeloId
          ? String(
              producto.modeloId,
            )
          : '',

      colorId:
        producto.colorId
          ? String(
              producto.colorId,
            )
          : '',

      materialId:
        producto.materialId
          ? String(
              producto.materialId,
            )
          : '',

      unidadMedidaId:
        unidadId
          ? String(
              unidadId,
            )
          : '',

      precioCompra:
        String(
          producto.precioCompra,
        ),

      precioVenta:
        String(
          producto.precioVenta,
        ),

      stockMinimo:
        String(
          producto.stockMinimo,
        ),

      stockMaximo:
        producto.stockMaximo === null
          ? ''
          : String(
              producto.stockMaximo,
            ),
    })


    setArchivoImagen(null)
    setImagenActual(producto.imagenUrl)
    setQuitarImagen(false)

    setError('')
    setExito('')

    setMostrarFormulario(
      true,
    )
  }


  // ========================================================
  // CERRAR FORMULARIO
  // ========================================================

  function cerrarFormulario() {
    if (
      guardando
    ) {
      return
    }

    setMostrarFormulario(
      false,
    )

    setProductoEditando(
      null,
    )

    setFormulario(
      formularioInicial,
    )

    setArchivoImagen(null)
    setImagenActual(null)
    setQuitarImagen(false)

    setError('')
  }


  // ========================================================
  // SELECCIONAR IMAGEN
  // ========================================================

  function seleccionarImagen(
    archivo: File | null,
  ) {
    setError('')

    if (!archivo) {
      setArchivoImagen(null)
      return
    }

    if (
      !TIPOS_IMAGEN.includes(
        archivo.type,
      )
    ) {
      setError(
        'La imagen debe ser JPG, PNG o WEBP.',
      )
      return
    }

    if (
      archivo.size >
      TAMANO_MAXIMO_IMAGEN
    ) {
      setError(
        'La imagen no puede superar 2 MB.',
      )
      return
    }

    setArchivoImagen(archivo)
    setQuitarImagen(false)
  }


  // ========================================================
  // GUARDAR IMAGEN EN STORAGE
  //
  // Se ejecuta después de guardar el producto. Si falla, el
  // producto queda guardado y se informa el problema.
  // ========================================================

  async function sincronizarImagen(
    productoId: number,
  ) {
    const rutaAnterior =
      rutaDesdeUrlPublica(
        imagenActual,
      )

    let nuevaUrl: string | null | undefined

    if (archivoImagen) {
      const extension =
        archivoImagen.name
          .split('.')
          .pop()
          ?.toLowerCase() ??
        'jpg'

      const ruta =
        `${productoId}/${Date.now()}.${extension}`

      const {
        error: subirError,
      } =
        await supabase.storage
          .from(BUCKET_IMAGENES)
          .upload(
            ruta,
            archivoImagen,
            {
              contentType:
                archivoImagen.type,
              upsert: false,
            },
          )

      if (subirError) {
        throw new Error(
          `El producto se guardó, pero no fue posible subir la imagen: ${subirError.message}`,
        )
      }

      nuevaUrl =
        supabase.storage
          .from(BUCKET_IMAGENES)
          .getPublicUrl(ruta)
          .data.publicUrl
    } else if (quitarImagen) {
      nuevaUrl = null
    }

    // Sin cambios en la imagen.
    if (nuevaUrl === undefined) {
      return
    }

    const {
      error: urlError,
    } =
      await supabase
        .from('productos')
        .update({
          imagen_url: nuevaUrl,
        })
        .eq('id', productoId)

    if (urlError) {
      throw new Error(
        `El producto se guardó, pero no fue posible asociar la imagen: ${urlError.message}`,
      )
    }

    // Limpieza del archivo anterior (no bloquea si falla).
    if (rutaAnterior) {
      await supabase.storage
        .from(BUCKET_IMAGENES)
        .remove([rutaAnterior])
    }
  }


  // ========================================================
  // GUARDAR PRODUCTO
  // ========================================================

  async function guardarProducto(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setError('')
    setExito('')


    if (
      !puedeAdministrar
    ) {
      setError(
        'No tiene permisos para administrar productos.',
      )

      return
    }


    const codigo =
      formulario.codigo
        .trim()
        .toUpperCase()


    const nombre =
      formulario.nombre
        .trim()


    const categoriaId =
      Number(
        formulario.categoriaId,
      )


    const unidadMedidaId =
      Number(
        formulario.unidadMedidaId,
      )


    const precioCompra =
      Number(
        formulario.precioCompra,
      )


    const precioVenta =
      Number(
        formulario.precioVenta,
      )


    const stockMinimo =
      Number(
        formulario.stockMinimo,
      )

    const stockMaximo =
    formulario.stockMaximo.trim() === ''
      ? null
      : Number(
          formulario.stockMaximo,
      )


    // ======================================================
    // VALIDACIONES
    // ======================================================

    if (
      !codigo ||
      !nombre ||
      !Number.isInteger(
        categoriaId,
      ) ||
      categoriaId <= 0 ||
      !Number.isInteger(
        unidadMedidaId,
      ) ||
      unidadMedidaId <= 0
    ) {
      setError(
        'Complete los campos obligatorios.',
      )

      return
    }


    if (
  !Number.isFinite(precioCompra) ||
  precioCompra < 0 ||
  !Number.isFinite(precioVenta) ||
  precioVenta < 0 ||
  !Number.isFinite(stockMinimo) ||
  stockMinimo < 0 ||
  (
    stockMaximo !== null &&
    (
      !Number.isFinite(stockMaximo) ||
      stockMaximo < 0 ||
      stockMaximo < stockMinimo
    )
  )
) {
  setError(
    'Los precios y niveles de stock deben ser válidos. El stock máximo no puede ser menor que el stock mínimo.',
  )

  return
}


    const unidadSeleccionada =
      unidadesMedida.find(
        unidad =>
          unidad.id ===
          unidadMedidaId,
      )


    if (
      !unidadSeleccionada
    ) {
      setError(
        'Seleccione una unidad de medida válida.',
      )

      return
    }


    const numeroONull = (
      valor: string,
    ) => {
      if (!valor) {
        return null
      }

      const numero =
        Number(valor)

      return Number.isInteger(
        numero,
      ) &&
        numero > 0
        ? numero
        : null
    }


    const datosProducto = {
      codigo,

      nombre,

      descripcion:
        formulario.descripcion
          .trim() ||
        null,

      categoria_id:
        categoriaId,


      marca_id:
        numeroONull(
          formulario.marcaId,
        ),

      modelo_id:
        numeroONull(
          formulario.modeloId,
        ),

      color_id:
        numeroONull(
          formulario.colorId,
        ),

      material_id:
        numeroONull(
          formulario.materialId,
        ),

      unidad_medida_id:
        unidadMedidaId,


      /*
       * Se mantiene también el campo de texto
       * por compatibilidad con la estructura anterior.
       */
      unidad_medida:
        unidadSeleccionada.nombre,


      precio_compra:
        precioCompra,

      precio_venta:
        precioVenta,

      stock_minimo:
        stockMinimo,
      
      stock_maximo:
        stockMaximo,
    }


    try {
      setGuardando(
        true,
      )

      let productoGuardadoId: number | null =
        productoEditando


      // ======================================================
      // EDITAR
      // ======================================================

      if (
        productoEditando !==
        null
      ) {
        const {
          error:
            actualizarError,
        } =
          await supabase
            .from(
              'productos',
            )
            .update(
              datosProducto,
            )
            .eq(
              'id',
              productoEditando,
            )


        if (
          actualizarError
        ) {
          throw actualizarError
        }


        setExito(
          'Producto actualizado correctamente.',
        )
      } else {

        // ====================================================
        // CREAR
        // ====================================================

        const {
          data:
            productoCreado,
          error:
            insertarError,
        } =
          await supabase
            .from(
              'productos',
            )
            .insert({
              ...datosProducto,
              activo:
                true,
            })
            .select('id')
            .single()


        if (
          insertarError
        ) {
          if (
            insertarError.code ===
            '23505'
          ) {
            throw new Error(
              'Ya existe un producto con ese código.',
            )
          }

          throw insertarError
        }


        productoGuardadoId =
          Number(
            productoCreado.id,
          )

        setExito(
          'Producto creado correctamente.',
        )
      }


      // ======================================================
      // IMAGEN
      // ======================================================

      let avisoImagen = ''

      if (
        productoGuardadoId !==
        null
      ) {
        try {
          await sincronizarImagen(
            productoGuardadoId,
          )
        } catch (errImagen) {
          avisoImagen =
            obtenerMensajeError(
              errImagen,
              'El producto se guardó, pero no fue posible guardar la imagen.',
            )
        }
      }


      setMostrarFormulario(
        false,
      )

      setProductoEditando(
        null,
      )

      setFormulario(
        formularioInicial,
      )

      setArchivoImagen(null)
      setImagenActual(null)
      setQuitarImagen(false)


      await cargarDatos()

      if (avisoImagen) {
        setError(avisoImagen)
      }
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible guardar el producto.',
        ),
      )
    } finally {
      setGuardando(
        false,
      )
    }
  }


  // ========================================================
  // CARGANDO
  // ========================================================

  if (
    cargando
  ) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando productos...
        </span>
      </div>
    )
  }


  // ========================================================
  // INTERFAZ
  // ========================================================

  return (
    <div className="inventory-module">

      {/* ====================================================
          ENCABEZADO
      ==================================================== */}

      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            CATÁLOGO DE PRODUCTOS
          </span>

          <h2>
            Productos
          </h2>

          <p>
            {puedeAdministrar
              ? 'Administración del catálogo maestro de productos de Casa Hogar.'
              : 'Consulta del catálogo maestro de productos de Casa Hogar.'}
          </p>
        </div>


        <div className="product-toolbar-actions">
          <button
            type="button"
            className="inventory-refresh-button"
            onClick={() =>
              void cargarDatos()
            }
          >
            ↻ Actualizar
          </button>


          {puedeAdministrar && (
            <button
              type="button"
              className="product-primary-button"
              onClick={
                abrirNuevoProducto
              }
            >
              + Nuevo producto
            </button>
          )}
        </div>
      </div>


      {/* ====================================================
          RESUMEN
      ==================================================== */}

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>
            PRODUCTOS ACTIVOS
          </span>

          <strong>
            {
              resumen.total
            }
          </strong>

          <p>
            registrados
          </p>
        </article>


        <article className="inventory-summary-card">
          <span>
            CATEGORÍAS
          </span>

          <strong>
            {
              resumen.categorias
            }
          </strong>

          <p>
            utilizadas
          </p>
        </article>


        <article className="inventory-summary-card">
          <span>
            CON EXISTENCIA
          </span>

          <strong>
            {
              resumen.conExistencia
            }
          </strong>

          <p>
            productos
          </p>
        </article>


        <article className="inventory-summary-card">
          <span>
            SIN EXISTENCIA
          </span>

          <strong>
            {
              resumen.sinExistencia
            }
          </strong>

          <p>
            productos
          </p>
        </article>
      </div>


      {/* ====================================================
          FORMULARIO
          SOLO ENCARGADO DE COMPRAS
      ==================================================== */}

      {mostrarFormulario &&
        puedeAdministrar && (
          <section className="product-form-card">

            <div className="product-form-head">
              <div>
                <span className="panel-label">
                  {productoEditando !==
                  null
                    ? 'EDITAR PRODUCTO'
                    : 'NUEVO PRODUCTO'}
                </span>

                <h3>
                  {productoEditando !==
                  null
                    ? 'Actualizar producto'
                    : 'Registrar producto'}
                </h3>

                <p>
                  {productoEditando !==
                  null
                    ? 'Modifica los datos maestros del producto.'
                    : 'Registra un nuevo producto en el catálogo.'}
                </p>
              </div>


              <button
                type="button"
                className="product-close-button"
                onClick={
                  cerrarFormulario
                }
              >
                ×
              </button>
            </div>


            <form
              className="product-form"
              onSubmit={
                guardarProducto
              }
            >

              {/* CÓDIGO */}

              <div className="product-field">
                <label htmlFor="prod-codigo">
                  Código *
                </label>

                <input
                  id="prod-codigo"
                  type="text"
                  value={
                    formulario.codigo
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'codigo',
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="Ej. PROD-004"
                  required
                />
              </div>


              {/* NOMBRE */}

              <div className="product-field product-field--double">
                <label htmlFor="prod-nombre">
                  Nombre *
                </label>

                <input
                  id="prod-nombre"
                  type="text"
                  value={
                    formulario.nombre
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'nombre',
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="Nombre del producto"
                  required
                />
              </div>


              {/* CATEGORÍA */}

              <div className="product-field">
                <label htmlFor="prod-categoria">
                  Categoría *
                </label>

                <select
                  id="prod-categoria"
                  value={
                    formulario.categoriaId
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'categoriaId',
                        event
                          .target
                          .value,
                      )
                  }
                  required
                >
                  <option value="">
                    Seleccionar
                  </option>

                  {categorias.map(
                    categoria => (
                      <option
                        key={
                          categoria.id
                        }
                        value={
                          categoria.id
                        }
                      >
                        {
                          categoria.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>


              {/* MARCA */}

              <div className="product-field">
                <label htmlFor="prod-marca">
                  Marca
                </label>

                <select
                  id="prod-marca"
                  value={
                    formulario.marcaId
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'marcaId',
                        event
                          .target
                          .value,
                      )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {marcas.map(
                    marca => (
                      <option
                        key={
                          marca.id
                        }
                        value={
                          marca.id
                        }
                      >
                        {
                          marca.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>


              {/* MODELO */}

              <div className="product-field">
                <label htmlFor="prod-modelo">
                  Modelo
                </label>

                <select
                  id="prod-modelo"
                  value={
                    formulario.modeloId
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'modeloId',
                        event
                          .target
                          .value,
                      )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {modelos.map(
                    modelo => (
                      <option
                        key={
                          modelo.id
                        }
                        value={
                          modelo.id
                        }
                      >
                        {
                          modelo.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>


              {/* COLOR */}

              <div className="product-field">
                <label htmlFor="prod-color">
                  Color
                </label>

                <select
                  id="prod-color"
                  value={
                    formulario.colorId
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'colorId',
                        event
                          .target
                          .value,
                      )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {colores.map(
                    color => (
                      <option
                        key={
                          color.id
                        }
                        value={
                          color.id
                        }
                      >
                        {
                          color.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>


              {/* MATERIAL */}

              <div className="product-field">
                <label htmlFor="prod-material">
                  Material
                </label>

                <select
                  id="prod-material"
                  value={
                    formulario.materialId
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'materialId',
                        event
                          .target
                          .value,
                      )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {materiales.map(
                    material => (
                      <option
                        key={
                          material.id
                        }
                        value={
                          material.id
                        }
                      >
                        {
                          material.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>


              {/* UNIDAD */}

              <div className="product-field">
                <label htmlFor="prod-unidad">
                  Unidad de medida *
                </label>

                <select
                  id="prod-unidad"
                  value={
                    formulario.unidadMedidaId
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'unidadMedidaId',
                        event
                          .target
                          .value,
                      )
                  }
                  required
                >
                  <option value="">
                    Seleccionar
                  </option>

                  {unidadesMedida.map(
                    unidad => (
                      <option
                        key={
                          unidad.id
                        }
                        value={
                          unidad.id
                        }
                      >
                        {
                          unidad.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>


              {/* PRECIO COMPRA */}

              <div className="product-field">
                <label htmlFor="prod-compra">
                  Precio compra
                </label>

                <input
                  id="prod-compra"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.precioCompra
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'precioCompra',
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="0.00"
                />
              </div>


              {/* PRECIO VENTA */}

              <div className="product-field">
                <label htmlFor="prod-venta">
                  Precio venta
                </label>

                <input
                  id="prod-venta"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.precioVenta
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'precioVenta',
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="0.00"
                />
              </div>


              {/* STOCK MÍNIMO */}

              <div className="product-field">
                <label htmlFor="prod-minimo">
                  Stock mínimo
                </label>

                <input
                  id="prod-minimo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.stockMinimo
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'stockMinimo',
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="0"
                />
              </div>
              
              {/* STOCK MÁXIMO */}

              <div className="product-field">
                <label htmlFor="prod-maximo">
                  Stock máximo
                </label>

                <input
                  id="prod-maximo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.stockMaximo
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'stockMaximo',
                        event.target.value,
                      )
                  }
                  placeholder="Sin definir"
                />
              </div>

              {/* DESCRIPCIÓN */}

              <div className="product-field product-field--full">
                <label htmlFor="prod-descripcion">
                  Descripción
                </label>

                <textarea
                  id="prod-descripcion"
                  value={
                    formulario.descripcion
                  }
                  onChange={
                    event =>
                      actualizarFormulario(
                        'descripcion',
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="Descripción breve del producto"
                  rows={3}
                />
              </div>


              {/* IMAGEN (se muestra en la tienda en línea) */}

              <div className="product-field product-field--full">
                <label htmlFor="prod-imagen">
                  Imagen para la tienda en línea
                </label>

                <div className="product-image-field">
                  {(vistaPreviaImagen || (imagenActual && !quitarImagen)) && (
                    <img
                      className="product-image-preview"
                      src={
                        vistaPreviaImagen ??
                        imagenActual ??
                        ''
                      }
                      alt="Vista previa del producto"
                    />
                  )}

                  <div className="product-image-controls">
                    <input
                      id="prod-imagen"
                      type="file"
                      accept={TIPOS_IMAGEN.join(',')}
                      onChange={
                        event =>
                          seleccionarImagen(
                            event.target.files?.[0] ?? null,
                          )
                      }
                      disabled={guardando}
                    />

                    <small>
                      JPG, PNG o WEBP · máximo 2 MB.
                    </small>

                    {imagenActual &&
                      !archivoImagen && (
                        <label className="product-image-remove">
                          <input
                            type="checkbox"
                            checked={quitarImagen}
                            onChange={
                              event =>
                                setQuitarImagen(
                                  event.target.checked,
                                )
                            }
                            disabled={guardando}
                          />
                          Quitar la imagen actual
                        </label>
                      )}
                  </div>
                </div>
              </div>


              {/* BOTONES */}

              <div className="product-form-actions">
                <button
                  type="button"
                  className="product-secondary-button"
                  onClick={
                    cerrarFormulario
                  }
                  disabled={
                    guardando
                  }
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="product-primary-button"
                  disabled={
                    guardando
                  }
                >
                  {guardando
                    ? 'Guardando...'
                    : productoEditando !==
                        null
                      ? 'Guardar cambios'
                      : 'Crear producto'}
                </button>
              </div>
            </form>
          </section>
        )}


      {/* ====================================================
          MENSAJES
      ==================================================== */}

      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}


      {exito && (
        <div className="movement-success">
          {exito}
        </div>
      )}


      {/* ====================================================
          BÚSQUEDA
      ==================================================== */}

      <div className="inventory-search-row">
        <div className="inventory-search">
          <span>
            ⌕
          </span>

          <input
            type="text"
            value={
              busqueda
            }
            onChange={
              event =>
                setBusqueda(
                  event
                    .target
                    .value,
                )
            }
            placeholder="Buscar por código, producto, categoría, marca, modelo, color..."
          />
        </div>


        <div className="productos-resultados">
          {filtrosActivos.map(filtro => (
            <button
              key={filtro.campo}
              type="button"
              className="productos-chip"
              onClick={() =>
                cambiarFiltro(
                  filtro.campo,
                  '',
                )
              }
              aria-label={`Quitar filtro ${filtro.texto}`}
            >
              {filtro.texto}
              <span aria-hidden="true">×</span>
            </button>
          ))}

          {hayFiltros && (
            <button
              type="button"
              className="productos-limpiar"
              onClick={limpiarFiltros}
            >
              Limpiar filtros
            </button>
          )}

          <span className="inventory-result-count">
            {
              productosFiltrados.length
            }{' '}

            resultado
            {productosFiltrados.length ===
            1
              ? ''
              : 's'}
          </span>
        </div>
      </div>


      {/* ====================================================
          TABLA
      ==================================================== */}

      {!error && (
        <div className="inventory-table-container productos-tabla-contenedor">
          <table className="inventory-table productos-tabla">
            <thead>
              <tr>
                <th className="productos-col-codigo">Código</th>
                <th className="productos-col-nombre">Producto</th>

                {/* El título es el filtro: un select transparente
                    encima abre el menú nativo al hacer clic. */}
                {COLUMNAS_FILTRO.map(columna => (
                  <th
                    key={columna}
                    className={
                      filtros[columna]
                        ? 'productos-th-filtro is-activo'
                        : 'productos-th-filtro'
                    }
                  >
                    <span>
                      {TITULOS_FILTRO[columna][0]}
                    </span>

                    <IconoMenu />

                    <select
                      value={filtros[columna]}
                      onChange={event =>
                        cambiarFiltro(
                          columna,
                          event.target.value,
                        )
                      }
                      aria-label={`Filtrar por ${TITULOS_FILTRO[columna][0].toLowerCase()}`}
                    >
                      <option value="">
                        {TITULOS_FILTRO[columna][1]}
                      </option>

                      {opcionesFiltro[columna].map(
                        valor => (
                          <option
                            key={valor}
                            value={valor}
                          >
                            {valor}
                          </option>
                        ),
                      )}
                    </select>
                  </th>
                ))}

                <th>Precio compra</th>
                <th>Precio venta</th>

                <th
                  className={
                    filtros.existencia
                      ? 'productos-th-filtro is-activo'
                      : 'productos-th-filtro'
                  }
                >
                  <span>
                    Existencia
                  </span>

                  <IconoMenu />

                  <select
                    value={filtros.existencia}
                    onChange={event =>
                      cambiarFiltro(
                        'existencia',
                        event.target.value,
                      )
                    }
                    aria-label="Filtrar por existencia"
                  >
                    {ESTADOS_EXISTENCIA.map(
                      estado => (
                        <option
                          key={estado.valor}
                          value={estado.valor}
                        >
                          {estado.etiqueta}
                        </option>
                      ),
                    )}
                  </select>
                </th>

                <th>Stock mínimo</th>
                <th>Stock máximo</th>
                {puedeAdministrar && (
                  <th className="productos-col-acciones">
                    Acciones
                  </th>
                )}
              </tr>
            </thead>


            <tbody>
              {productosFiltrados.length >
              0 ? (
                productosFiltrados.map(
                  producto => (
                    <tr
                      key={
                        producto.id
                      }
                    >
                      <td className="productos-col-codigo">
                        <span className="product-code">
                          {
                            producto.codigo
                          }
                        </span>
                      </td>


                      <td className="productos-col-nombre">
                        <strong className="product-name">
                          {
                            producto.nombre
                          }
                        </strong>
                      </td>


                      <td>
                        {
                          producto.categoria
                        }
                      </td>


                      <td>
                          {producto.marca}
                        </td>

                        <td>
                          {producto.modelo}
                        </td>

                        <td>
                          {producto.color}
                        </td>

                        <td>
                          {producto.material}
                        </td>


                      <td>
                        {
                          producto.unidad
                        }
                      </td>


                      <td>
                        {formatearCordobas(
                          producto.precioCompra,
                        )}
                      </td>


                      <td>
                        {formatearCordobas(
                          producto.precioVenta,
                        )}
                      </td>


                      <td>
                        <strong className="stock-value">
                          {
                            producto.stock
                          }
                        </strong>
                      </td>


                      <td>
                        {
                          producto.stockMinimo
                        }
                      </td>
                      
                      <td>
                        {producto.stockMaximo ?? 'Sin definir'}
                      </td>

                      {puedeAdministrar && (
                        <td className="productos-col-acciones">
                          <button
                            type="button"
                            className="product-edit-button"
                            onClick={() =>
                              abrirEditarProducto(
                                producto,
                              )
                            }
                          >
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )
              ) : (
                <tr>
                  <td
                    colSpan={
                      puedeAdministrar
                        ? 14
                        : 13
                    }
                    className="inventory-empty"
                  >
                    No se encontraron productos
                    {hayFiltros
                      ? ' con estos filtros.'
                      : '.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}