import {

  useEffect,

  useMemo,

  useState,

} from 'react'


import { supabase } from '../lib/supabase'


type Proveedor = {

  id: number

  codigo: string

  nombre: string

  activo?: boolean

}


type Producto = {

  id: number

  codigo: string

  nombre: string

  unidad_medida: string

  precio_compra: number | string | null

  activo: boolean

}


type ProveedorRelacion =

  | Proveedor

  | Proveedor[]

  | null


type ProductoDetalle = {

  codigo: string

  nombre: string

  unidad_medida: string

}


type ProductoDetalleRelacion =

  | ProductoDetalle

  | ProductoDetalle[]

  | null


type EstadoCompra =

  | 'registrada'

  | 'autorizada'

  | 'recibida'

  | 'anulada'


type TipoCompra =

  | 'directa'

  | 'cotizacion'

  | 'licitacion'


type Compra = {

  id: number

  numero: string

  proveedor_id: number

  fecha_compra: string

  referencia_documento: string | null

  observaciones: string | null

  total: number | string

  tipo_compra: TipoCompra

  estado: EstadoCompra

  autorizada_at: string | null

  motivo_anulacion: string | null

  anulada_at: string | null

  created_at: string

  proveedores: ProveedorRelacion

}


type DetalleCompra = {

  id: number

  compra_id: number

  producto_id: number

  cantidad: number | string

  costo_unitario: number | string

  subtotal: number | string

  productos: ProductoDetalleRelacion

}


type ItemCompra = {

  producto_id: number

  codigo: string

  nombre: string

  unidad_medida: string

  cantidad: string

  costo_unitario: string

}


// Fila de reposicion_sugerida(): producto en o bajo su mínimo
type Sugerencia = {
  producto_id: number
  codigo: string
  nombre: string
  categoria: string
  unidad_medida: string
  existencia: number
  stock_minimo: number
  stock_maximo: number | null
  en_camino: number
  ventas_30d: number
  cantidad_sugerida: number
  costo_referencia: number | null
  proveedor_id: number | null
  proveedor_nombre: string | null
  proveedor_costo: number | null
}


type PurchasesModuleProps = {

  roleCode: string
  vista: string
}


function fechaLocalActual() {

  const fecha = new Date()


  const year =

    fecha.getFullYear()


  const month =

    String(

      fecha.getMonth() + 1,

    ).padStart(2, '0')


  const day =

    String(

      fecha.getDate(),

    ).padStart(2, '0')


  return `${year}-${month}-${day}`

}


function obtenerProveedor(

  relacion: ProveedorRelacion,

) {

  if (!relacion) {

    return null

  }


  if (Array.isArray(relacion)) {

    return relacion[0] ?? null

  }


  return relacion

}


function obtenerProductoDetalle(

  relacion: ProductoDetalleRelacion,

) {

  if (!relacion) {

    return null

  }


  if (Array.isArray(relacion)) {

    return relacion[0] ?? null

  }


  return relacion

}


function moneda(

  valor: number | string,

) {

  const numero =

    Number(valor) || 0


  return new Intl.NumberFormat(

    'es-NI',

    {

      style: 'currency',

      currency: 'NIO',

      minimumFractionDigits: 2,

    },

  ).format(numero)

}


function etiquetaTipoCompra(

  tipo: TipoCompra,

) {

  if (tipo === 'cotizacion') {

    return 'Cotización'

  }


  if (tipo === 'licitacion') {

    return 'Licitación'

  }


  return 'Compra directa'

}


function etiquetaEstadoCompra(

  estado: EstadoCompra,

) {

  if (estado === 'registrada') {

    return 'Registrada'

  }


  if (estado === 'autorizada') {

    return 'Autorizada'

  }


  if (estado === 'recibida') {

    return 'Recibida'

  }


  return 'Anulada'

}


function claseEstadoCompra(

  estado: EstadoCompra,

) {

  if (estado === 'anulada') {

    return 'status-badge status-danger'

  }


  if (

    estado === 'autorizada' ||

    estado === 'recibida'

  ) {

    return 'status-badge status-success'

  }


  return 'status-badge status-en-proceso'

}


function obtenerMensajeError(

  err: unknown,

  respaldo: string,

) {

  if (

    typeof err === 'object' &&

    err !== null &&

    'message' in err &&

    typeof (

      err as {

        message?: unknown

      }

    ).message === 'string'

  ) {

    return (

      (

        err as {

          message: string

        }

      ).message ||

      respaldo

    )

  }


  if (err instanceof Error) {

    return err.message

  }


  return respaldo

}


function PurchasesModule({
  roleCode,
  vista,
}: PurchasesModuleProps) {

  const [

    proveedores,

    setProveedores,

  ] =

    useState<Proveedor[]>([])


  const [

    productos,

    setProductos,

  ] =

    useState<Producto[]>([])


  const [

    compras,

    setCompras,

  ] =

    useState<Compra[]>([])


  const [

    detalles,

    setDetalles,

  ] =

    useState<DetalleCompra[]>([])


  const [

    compraSeleccionada,

    setCompraSeleccionada,

  ] =

    useState<Compra | null>(

      null,

    )


  const [

    mostrarFormulario,

    setMostrarFormulario,

  ] =

    useState(false)


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

    procesandoAccion,

    setProcesandoAccion,

  ] =

    useState(false)


  const [

    cargandoDetalle,

    setCargandoDetalle,

  ] =

    useState(false)


  const [

    mensaje,

    setMensaje,

  ] =

    useState('')


  const [

    error,

    setError,

  ] =

    useState('')


  const [

    busqueda,

    setBusqueda,

  ] =

    useState('')


  const [

    proveedorId,

    setProveedorId,

  ] =

    useState('')


  const [

    tipoCompra,

    setTipoCompra,

  ] =

    useState<TipoCompra>(

      'directa',

    )


  const [

    fechaCompra,

    setFechaCompra,

  ] =

    useState(

      fechaLocalActual(),

    )


  const [

    referenciaDocumento,

    setReferenciaDocumento,

  ] =

    useState('')


  const [

    observaciones,

    setObservaciones,

  ] =

    useState('')


  const [

    productoElegido,

    setProductoElegido,

  ] =

    useState('')


  const [items, setItems] =
  useState<ItemCompra[]>([])

  const [sugerencias, setSugerencias] =
    useState<Sugerencia[]>([])

const esOrdenesCompra =
  vista === 'ordenes-compra'

const esAutorizacion =
  vista === 'autorizacion-compras'

const esHistorial =
  vista === 'historial-compras'

const puedeRegistrar =
  roleCode === 'encargado_compras' &&
  esOrdenesCompra

const puedeAutorizar =
  roleCode === 'responsable_compras' &&
  esAutorizacion

/*
 * El Responsable de Compras, al revisar una orden, puede
 * rechazarla (anularla) mientras no haya sido recibida.
 * Validado también en anular_compra().
 */
const puedeAnular =
  roleCode === 'responsable_compras' &&
  esAutorizacion

const tituloVista =
  esOrdenesCompra
    ? 'Compras'
    : esAutorizacion
      ? 'Autorización de compras'
      : esHistorial
        ? 'Historial de compras'
        : 'Compras'

const descripcionVista =
  esOrdenesCompra
    ? 'Registra y da seguimiento a las compras pendientes.'
    : esAutorizacion
      ? 'Revisa y autoriza las órdenes de compra pendientes.'
      : esHistorial
        ? 'Consulta las compras que ya fueron recibidas y completadas.'
        : 'Gestión de compras.'
  // ==========================================================

  // CARGAR DATOS

  // ==========================================================


  async function cargarProveedores() {

    const {

      data,

      error,

    } =

      await supabase

        .from('proveedores')

        .select(`

          id,

          codigo,

          nombre,

          activo

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

        )


    if (error) {

      throw error

    }


    setProveedores(

      (data ??

        []) as Proveedor[],

    )

  }


  async function cargarProductos() {

    const {

      data,

      error,

    } =

      await supabase

        .from('productos')

        .select(`

          id,

          codigo,

          nombre,

          unidad_medida,

          precio_compra,

          activo

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

        )


    if (error) {

      throw error

    }


    setProductos(

      (data ??

        []) as Producto[],

    )

  }


  async function cargarCompras() {

    const {

      data,

      error,

    } =

      await supabase

        .from('compras')

        .select(`

          id,

          numero,

          proveedor_id,

          tipo_compra,

          fecha_compra,

          referencia_documento,

          observaciones,

          total,

          estado,

          autorizada_at,

          motivo_anulacion,

          anulada_at,

          created_at,

          proveedores (

            id,

            codigo,

            nombre

          )

        `)

        .order(

          'created_at',

          {

            ascending:

              false,

          },

        )

        .limit(100)


    if (error) {

      throw error

    }


    setCompras(

      (data ??

        []) as unknown as Compra[],

    )

  }


  /*
   * Productos en o bajo su mínimo con la cantidad a comprar
   * (ya descuenta lo pedido que no ha llegado). Solo la usa
   * el Encargado de Compras al armar una compra.
   */
  async function cargarSugerencias() {
    if (roleCode !== 'encargado_compras') {
      return
    }

    const { data, error } =
      await supabase.rpc(
        'reposicion_sugerida',
      )

    if (error) {
      throw error
    }

    setSugerencias(
      (data ?? []) as Sugerencia[],
    )
  }


  async function cargarTodo() {

    try {

      setCargando(true)

      setError('')


      await Promise.all([

        cargarProveedores(),

        cargarProductos(),

        cargarCompras(),

        cargarSugerencias(),

      ])

    } catch (err) {

      setError(

        obtenerMensajeError(

          err,

          'No fue posible cargar el módulo de compras.',

        ),

      )

    } finally {

      setCargando(false)

    }

  }


  useEffect(() => {

    void cargarTodo()

  }, [])


  // ==========================================================

  // ESTADÍSTICAS

  // ==========================================================


  const comprasRegistradas =

    useMemo(

      () =>

        compras.filter(

          compra =>

            compra.estado ===

            'registrada',

        ),

      [compras],

    )


  const comprasAnuladas =

    useMemo(

      () =>

        compras.filter(

          compra =>

            compra.estado ===

            'anulada',

        ),

      [compras],

    )


  const totalVigente =

    useMemo(

      () =>

        compras

          .filter(

            compra =>

              compra.estado !==

              'anulada',

          )

          .reduce(

            (

              total,

              compra,

            ) =>

              total +

              Number(

                compra.total,

              ),

            0,

          ),

      [compras],

    )

    // ==========================================================
// FILTRAR COMPRAS SEGÚN LA VISTA
// ==========================================================

const comprasPorVista =
  useMemo(() => {
    if (esOrdenesCompra) {
      return compras.filter(
        compra =>
          compra.estado === 'registrada' ||
          compra.estado === 'autorizada',
      )
    }

    if (esAutorizacion) {
      return compras.filter(
        compra =>
          compra.estado === 'registrada',
      )
    }

    if (esHistorial) {
      return compras.filter(
        compra =>
          compra.estado === 'recibida',
      )
    }

    return compras
  }, [
    compras,
    esOrdenesCompra,
    esAutorizacion,
    esHistorial,
  ])

// ==========================================================
// BUSCADOR
// ==========================================================

const comprasFiltradas =
  useMemo(() => {
    const termino =
      busqueda
        .trim()
        .toLowerCase()

    if (!termino) {
      return comprasPorVista
    }

    return comprasPorVista.filter(
      compra => {
        const proveedor =
          obtenerProveedor(
            compra.proveedores,
          )

        const texto = [
          compra.numero,
          compra.tipo_compra,
          etiquetaTipoCompra(
            compra.tipo_compra,
          ),
          compra.estado,
          etiquetaEstadoCompra(
            compra.estado,
          ),
          compra.fecha_compra,
          compra.referencia_documento ?? '',
          proveedor?.codigo ?? '',
          proveedor?.nombre ?? '',
        ]
          .join(' ')
          .toLowerCase()

        return texto.includes(
          termino,
        )
      },
    )
  }, [
    comprasPorVista,
    busqueda,
  ])
  
  // ==========================================================

  // NUEVA COMPRA

  // ==========================================================


  function abrirNuevaCompra() {
    if (!puedeRegistrar) {
      return
    }

    setProveedorId('')


    setTipoCompra(

      'directa',

    )


    setFechaCompra(

      fechaLocalActual(),

    )


    setReferenciaDocumento(

      '',

    )


    setObservaciones('')


    setProductoElegido(

      '',

    )


    setItems([])


    setCompraSeleccionada(

      null,

    )


    setDetalles([])


    setError('')

    setMensaje('')


    setMostrarFormulario(

      true,

    )

  }


  /*
   * Lleva productos de la reposición sugerida a la compra con
   * la cantidad sugerida y el costo de referencia del producto.
   * Si el formulario estaba cerrado, abre una compra nueva; si
   * todos comparten el mismo proveedor sugerido, lo selecciona.
   */
  function agregarSugeridos(
    lista: Sugerencia[],
  ) {
    const actuales =
      mostrarFormulario ? items : []

    const nuevos = lista.filter(
      s =>
        Number(s.cantidad_sugerida) > 0 &&
        !actuales.some(
          item =>
            item.producto_id === s.producto_id,
        ),
    )

    if (nuevos.length === 0) {
      setMensaje('')
      setError(
        'Esos productos ya están en la compra.',
      )
      return
    }

    if (!mostrarFormulario) {
      abrirNuevaCompra()
    }

    setItems(previos => [
      ...(mostrarFormulario ? previos : []),
      ...nuevos.map(
        (s): ItemCompra => ({
          producto_id: s.producto_id,
          codigo: s.codigo,
          nombre: s.nombre,
          unidad_medida: s.unidad_medida,
          cantidad: String(
            Number(s.cantidad_sugerida),
          ),
          costo_unitario: Number(
            s.costo_referencia ?? 0,
          ).toFixed(2),
        }),
      ),
    ])

    const proveedoresSugeridos = new Set(
      nuevos.map(s => s.proveedor_id),
    )

    const [unicoProveedor] =
      proveedoresSugeridos

    if (
      (!mostrarFormulario || !proveedorId) &&
      proveedoresSugeridos.size === 1 &&
      unicoProveedor
    ) {
      setProveedorId(
        String(unicoProveedor),
      )
    }

    setError('')
    setMensaje(
      nuevos.length === 1
        ? `${nuevos[0].nombre} se agregó a la compra con la cantidad sugerida.`
        : `${nuevos.length} productos se agregaron a la compra con la cantidad sugerida.`,
    )
  }


  function cancelarCompra() {

    if (guardando) {

      return

    }


    setMostrarFormulario(

      false,

    )


    setItems([])


    setProductoElegido(

      '',

    )

  }


  // ==========================================================

  // AGREGAR PRODUCTO

  // ==========================================================


  function agregarProducto() {

    setError('')

    setMensaje('')


    if (!productoElegido) {

      setError(

        'Seleccione un producto.',

      )


      return

    }


    const producto =

      productos.find(

        item =>

          String(item.id) ===

          productoElegido,

      )


    if (!producto) {

      setError(

        'El producto seleccionado no existe.',

      )


      return

    }


    const yaExiste =

      items.some(

        item =>

          item.producto_id ===

          producto.id,

      )


    if (yaExiste) {

      setError(

        'Ese producto ya está incluido en la compra.',

      )


      return

    }


    const precioCompra =

      Number(

        producto.precio_compra ??

          0,

      )


    const nuevoItem:

      ItemCompra = {

      producto_id:

        producto.id,


      codigo:

        producto.codigo,


      nombre:

        producto.nombre,


      unidad_medida:

        producto.unidad_medida,


      cantidad:

        '1',


      costo_unitario:

        precioCompra.toFixed(

          2,

        ),

    }


    setItems(

      actuales => [

        ...actuales,

        nuevoItem,

      ],

    )


    setProductoElegido(

      '',

    )

  }


  function actualizarItem(

    productoId: number,

    campo:

      | 'cantidad'

      | 'costo_unitario',

    valor: string,

  ) {

    setItems(

      actuales =>

        actuales.map(

          item =>

            item.producto_id ===

            productoId

              ? {

                  ...item,

                  [campo]:

                    valor,

                }

              : item,

        ),

    )

  }


  function eliminarItem(

    productoId: number,

  ) {

    setItems(

      actuales =>

        actuales.filter(

          item =>

            item.producto_id !==

            productoId,

        ),

    )

  }


  function obtenerSubtotal(

    item: ItemCompra,

  ) {

    const cantidad =

      Number(

        item.cantidad,

      )


    const costo =

      Number(

        item.costo_unitario,

      )


    if (

      !Number.isFinite(

        cantidad,

      ) ||

      !Number.isFinite(

        costo,

      )

    ) {

      return 0

    }


    return (

      cantidad *

      costo

    )

  }


  const totalCompra =

    useMemo(

      () =>

        items.reduce(

          (

            total,

            item,

          ) =>

            total +

            obtenerSubtotal(

              item,

            ),

          0,

        ),

      [items],

    )


  // ==========================================================

  // REGISTRAR COMPRA

  // ==========================================================


  async function registrarCompra() {
    if (!puedeRegistrar) {
      setError(
        'Este perfil no tiene permisos para registrar compras.',
      )
      return
    }

    try {

      setGuardando(true)

      setError('')

      setMensaje('')


      if (!proveedorId) {

        throw new Error(

          'Seleccione un proveedor.',

        )

      }


      if (!fechaCompra) {

        throw new Error(

          'Seleccione la fecha de compra.',

        )

      }


      if (

        items.length ===

        0

      ) {

        throw new Error(

          'Agregue al menos un producto.',

        )

      }


      for (

        const item of

        items

      ) {

        const cantidad =

          Number(

            item.cantidad,

          )


        const costo =

          Number(

            item.costo_unitario,

          )


        if (

          !Number.isFinite(

            cantidad,

          ) ||

          cantidad <= 0

        ) {

          throw new Error(

            `La cantidad de ${item.nombre} debe ser mayor que cero.`,

          )

        }


        if (

          item.unidad_medida

            .trim()

            .toLowerCase() ===

            'unidad' &&

          !Number.isInteger(

            cantidad,

          )

        ) {

          throw new Error(

            `La cantidad de ${item.nombre} debe ser un número entero porque su unidad de medida es unidad.`,

          )

        }


        if (

          !Number.isFinite(

            costo,

          ) ||

          costo < 0

        ) {

          throw new Error(

            `El costo de ${item.nombre} no es válido.`,

          )

        }

      }


      const itemsRpc =

        items.map(

          item => ({

            producto_id:

              item.producto_id,


            cantidad:

              Number(

                item.cantidad,

              ),


            costo_unitario:

              Number(

                item.costo_unitario,

              ),

          }),

        )


      const {

        data,

        error,

      } =

        await supabase.rpc(

          'registrar_compra',

          {

            p_proveedor_id:

              Number(

                proveedorId,

              ),


            p_items:

              itemsRpc,


            p_tipo_compra:

              tipoCompra,


            p_fecha_compra:

              fechaCompra,


            p_referencia_documento:

              referenciaDocumento

                .trim() ||

              null,


            p_observaciones:

              observaciones

                .trim() ||

              null,

          },

        )


      if (error) {

        throw error

      }


      const resultado =

        Array.isArray(data)

          ? data[0]

          : data


      const numero =

        resultado?.numero ??

        'registrada'


      setMensaje(

        `Compra ${numero} registrada correctamente. Está pendiente de autorización.`,

      )


      setMostrarFormulario(

        false,

      )


      setProveedorId('')


      setTipoCompra(

        'directa',

      )


      setFechaCompra(

        fechaLocalActual(),

      )


      setReferenciaDocumento(

        '',

      )


      setObservaciones('')


      setProductoElegido(

        '',

      )


      setItems([])


      await Promise.all([
        cargarCompras(),
        cargarSugerencias(),
      ])

    } catch (err) {

      setError(

        obtenerMensajeError(

          err,

          'No fue posible registrar la compra.',

        ),

      )

    } finally {

      setGuardando(false)

    }

  }


  // ==========================================================

  // VER DETALLE

  // ==========================================================


  async function verDetalle(

    compra: Compra,

  ) {

    try {

      setCargandoDetalle(

        true,

      )


      setError('')

      setMensaje('')


      setCompraSeleccionada(

        compra,

      )


      const {

        data,

        error,

      } =

        await supabase

          .from(

            'detalle_compras',

          )

          .select(`

            id,

            compra_id,

            producto_id,

            cantidad,

            costo_unitario,

            subtotal,

            productos (

              codigo,

              nombre,

              unidad_medida

            )

          `)

          .eq(

            'compra_id',

            compra.id,

          )

          .order(

            'id',

            {

              ascending:

                true,

            },

          )


      if (error) {

        throw error

      }


      setDetalles(

        (data ??

          []) as unknown as DetalleCompra[],

      )

    } catch (err) {

      setError(

        obtenerMensajeError(

          err,

          'No fue posible cargar el detalle de la compra.',

        ),

      )

    } finally {

      setCargandoDetalle(

        false,

      )

    }

  }


  function cerrarDetalle() {

    setCompraSeleccionada(

      null,

    )


    setDetalles([])

  }


  // ==========================================================

  // AUTORIZAR COMPRA

  // ==========================================================


  async function autorizarCompra(

    compra: Compra,

  ) {

    if (

      !puedeAutorizar ||

      compra.estado !==

        'registrada' ||

      procesandoAccion

    ) {

      return

    }


    const confirmado =

      window.confirm(

        `¿Deseas autorizar la compra ${compra.numero}? Después de autorizarla podrá ser recibida por Almacén.`,

      )


    if (!confirmado) {

      return

    }


    try {

      setProcesandoAccion(

        true,

      )


      setError('')

      setMensaje('')


      const {

        error,

      } =

        await supabase.rpc(

          'autorizar_compra',

          {

            p_compra_id:

              compra.id,

          },

        )


      if (error) {

        throw error

      }


      setMensaje(

        `Compra ${compra.numero} autorizada correctamente.`,

      )


      if (

        compraSeleccionada

          ?.id ===

        compra.id

      ) {

        cerrarDetalle()

      }


      await cargarCompras()

    } catch (err) {

      setError(

        obtenerMensajeError(

          err,

          'No fue posible autorizar la compra.',

        ),

      )

    } finally {

      setProcesandoAccion(

        false,

      )

    }

  }


  // ==========================================================

  // ANULAR COMPRA

  // ==========================================================


  async function anularCompra(

    compra: Compra,

  ) {

    if (

      !puedeAnular ||

      procesandoAccion

    ) {

      return

    }


    if (

      compra.estado !==

        'registrada' &&

      compra.estado !==

        'autorizada'

    ) {

      setError(

        'Solo pueden anularse compras registradas o autorizadas que todavía no hayan sido recibidas.',

      )


      return

    }


    const confirmado =

      window.confirm(

        `¿Deseas anular la compra ${compra.numero}?`,

      )


    if (!confirmado) {

      return

    }


    const motivo =

      window.prompt(

        'Indique el motivo de la anulación:',

      )


    if (

      motivo === null

    ) {

      return

    }


    if (

      motivo

        .trim()

        .length < 3

    ) {

      setError(

        'Debe indicar un motivo válido de al menos 3 caracteres.',

      )


      return

    }


    try {

      setProcesandoAccion(

        true,

      )


      setError('')

      setMensaje('')


      const {

        error,

      } =

        await supabase.rpc(

          'anular_compra',

          {

            p_compra_id:

              compra.id,


            p_motivo:

              motivo.trim(),

          },

        )


      if (error) {

        throw error

      }


      setMensaje(

        `Compra ${compra.numero} anulada correctamente.`,

      )


      if (

        compraSeleccionada

          ?.id ===

        compra.id

      ) {

        cerrarDetalle()

      }


      await cargarCompras()

    } catch (err) {

      setError(

        obtenerMensajeError(

          err,

          'No fue posible anular la compra.',

        ),

      )

    } finally {

      setProcesandoAccion(

        false,

      )

    }

  }


  // ==========================================================

  // INTERFAZ

  // ==========================================================


  if (cargando) {

    return (

      <div className="inventory-module">

        <div className="inventory-toolbar">

          Cargando compras...

        </div>

      </div>

    )

  }


  return (

    <div className="inventory-module">


      {/* ====================================================

          ENCABEZADO

      ==================================================== */}


      <div className="inventory-toolbar">

        <div>

          <span className="panel-label">

            ABASTECIMIENTO

          </span>


          <h2>
  {tituloVista}
</h2>

<p>
  {descripcionVista}
</p>

        </div>


        <div

          style={{

            display:

              'flex',

            gap:

              '10px',

            alignItems:

              'center',

          }}

        >

          <button

            type="button"

            className="secondary-button"

            onClick={() =>

              void cargarTodo()

            }

          >

            ↻ Actualizar

          </button>


          {puedeRegistrar && (
  <button
    type="button"
    className="primary-button"
    onClick={
      abrirNuevaCompra
    }
  >
    + Nueva compra
  </button>
)}

        </div>

      </div>


      {/* ====================================================

          ESTADÍSTICAS

      ==================================================== */}


      <div className="inventory-stats">

        <div className="inventory-stat-card">

          <span>

            PENDIENTES DE AUTORIZACIÓN

          </span>


          <strong>

            {

              comprasRegistradas.length

            }

          </strong>


          <small>

            compras registradas

          </small>

        </div>


        <div className="inventory-stat-card">

          <span>

            COMPRAS ANULADAS

          </span>


          <strong>

            {

              comprasAnuladas.length

            }

          </strong>


          <small>

            compras canceladas

          </small>

        </div>


        <div className="inventory-stat-card">

          <span>

            TOTAL VIGENTE

          </span>


          <strong

            style={{

              fontSize:

                '20px',

            }}

          >

            {moneda(

              totalVigente,

            )}

          </strong>


          <small>

            compras no anuladas

          </small>

        </div>


        <div className="inventory-stat-card">

          <span>

            PROVEEDORES ACTIVOS

          </span>


          <strong>

            {

              proveedores.length

            }

          </strong>


          <small>

            disponibles

          </small>

        </div>

      </div>


      {/* ====================================================

          MENSAJES

      ==================================================== */}


      {mensaje && (

        <div className="success-message">

          {mensaje}

        </div>

      )}


      {error && (

        <div className="error-message">

          {error}

        </div>

      )}


      {/* ====================================================
          REPOSICIÓN SUGERIDA
          Productos en o bajo el mínimo (reposicion_sugerida).
      ==================================================== */}

      {puedeRegistrar && sugerencias.length > 0 && (
        <section className="compras-reposicion">
          <div className="compras-reposicion-encabezado">
            <div>
              <span className="panel-label">
                REPOSICIÓN SUGERIDA
              </span>

              <h3>
                {sugerencias.length === 1
                  ? '1 producto en o bajo el mínimo'
                  : `${sugerencias.length} productos en o bajo el mínimo`}
              </h3>

              <p>
                La cantidad sugerida completa el stock máximo y ya descuenta lo pedido que no ha llegado.
              </p>
            </div>

            {sugerencias.some(
              s => Number(s.cantidad_sugerida) > 0,
            ) && (
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  agregarSugeridos(sugerencias)
                }
              >
                Agregar todo a la compra
              </button>
            )}
          </div>

          <div className="compras-reposicion-tabla">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Existencia</th>
                  <th>En camino</th>
                  <th>Sugerido</th>
                  <th>Proveedor sugerido</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {sugerencias.map(s => {
                  const agotado =
                    Number(s.existencia) <= 0

                  const enCompra =
                    mostrarFormulario &&
                    items.some(
                      item =>
                        item.producto_id === s.producto_id,
                    )

                  return (
                    <tr key={s.producto_id}>
                      <td>
                        <span className="product-code">
                          {s.codigo}
                        </span>
                        <strong className="compras-reposicion-nombre">
                          {s.nombre}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={
                            agotado
                              ? 'compras-reposicion-estado is-agotado'
                              : 'compras-reposicion-estado'
                          }
                        >
                          {agotado
                            ? 'Agotado'
                            : `${Number(s.existencia)} de mín. ${Number(s.stock_minimo)}`}
                        </span>
                      </td>

                      <td>
                        {Number(s.en_camino) > 0
                          ? Number(s.en_camino)
                          : '—'}
                      </td>

                      <td>
                        <strong>
                          {Number(s.cantidad_sugerida)}
                        </strong>{' '}
                        {s.unidad_medida}
                      </td>

                      <td>
                        {s.proveedor_nombre ?? 'Sin proveedor asignado'}
                      </td>

                      <td className="compras-reposicion-accion">
                        {Number(s.cantidad_sugerida) <= 0 ? (
                          <span className="compras-reposicion-nota">
                            Ya pedido
                          </span>
                        ) : enCompra ? (
                          <span className="compras-reposicion-nota">
                            En la compra
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="product-edit-button"
                            onClick={() =>
                              agregarSugeridos([s])
                            }
                          >
                            Agregar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}


      {/* ====================================================

          NUEVA COMPRA

      ==================================================== */}


      {puedeRegistrar && mostrarFormulario && (

        <div className="inventory-toolbar">

          <div

            style={{

              width:

                '100%',

            }}

          >

            <div

              style={{

                display:

                  'flex',

                justifyContent:

                  'space-between',

                alignItems:

                  'flex-start',

                gap:

                  '20px',

                marginBottom:

                  '24px',

              }}

            >

              <div>

                <span className="panel-label">

                  NUEVA COMPRA

                </span>


                <h2>

                  Registrar compra

                </h2>


                <p>

                  Selecciona el proveedor y agrega los productos de la compra.

                </p>

              </div>


              <button

                type="button"

                className="secondary-button"

                onClick={

                  cancelarCompra

                }

                disabled={

                  guardando

                }

              >

                ✕ Cerrar

              </button>

            </div>


            {/* DATOS GENERALES */}


            <div

              style={{

                display:

                  'grid',

                gridTemplateColumns:

                  '2fr 1fr 1fr 1fr',

                gap:

                  '16px',

                marginBottom:

                  '18px',

              }}

            >

              <label>

                Proveedor *


                <select

                  value={

                    proveedorId

                  }

                  onChange={

                    event =>

                      setProveedorId(

                        event

                          .target

                          .value,

                      )

                  }

                >

                  <option value="">

                    Seleccione proveedor

                  </option>


                  {proveedores.map(

                    proveedor => (

                      <option

                        key={

                          proveedor.id

                        }

                        value={

                          proveedor.id

                        }

                      >

                        {proveedor.codigo}

                        {' - '}

                        {proveedor.nombre}

                      </option>

                    ),

                  )}

                </select>

              </label>


              <label>

                Tipo de compra *


                <select

                  value={

                    tipoCompra

                  }

                  onChange={

                    event =>

                      setTipoCompra(

                        event

                          .target

                          .value as TipoCompra,

                      )

                  }

                >

                  <option value="directa">

                    Compra directa

                  </option>


                  <option value="cotizacion">

                    Cotización

                  </option>


                  <option value="licitacion">

                    Licitación

                  </option>

                </select>

              </label>


              <label>

                Fecha de compra *


                <input

                  type="date"

                  value={

                    fechaCompra

                  }

                  onChange={

                    event =>

                      setFechaCompra(

                        event

                          .target

                          .value,

                      )

                  }

                />

              </label>


              <label>

                Factura / referencia


                <input

                  type="text"

                  value={

                    referenciaDocumento

                  }

                  onChange={

                    event =>

                      setReferenciaDocumento(

                        event

                          .target

                          .value,

                      )

                  }

                  placeholder="Ej. FACT-0025"

                />

              </label>

            </div>


            <label>

              Observaciones


              <textarea

                value={

                  observaciones

                }

                onChange={

                  event =>

                    setObservaciones(

                      event

                        .target

                        .value,

                    )

                }

                placeholder="Información adicional de la compra..."

              />

            </label>


            {/* AGREGAR PRODUCTO */}


            <div

              style={{

                display:

                  'flex',

                alignItems:

                  'flex-end',

                gap:

                  '10px',

                marginTop:

                  '22px',

                marginBottom:

                  '14px',

              }}

            >

              <label

                style={{

                  flex: 1,

                }}

              >

                Agregar producto


                <select

                  value={

                    productoElegido

                  }

                  onChange={

                    event =>

                      setProductoElegido(

                        event

                          .target

                          .value,

                      )

                  }

                >

                  <option value="">

                    Seleccione producto

                  </option>


                  {productos.map(

                    producto => (

                      <option

                        key={

                          producto.id

                        }

                        value={

                          producto.id

                        }

                      >

                        {producto.codigo}

                        {' - '}

                        {producto.nombre}

                      </option>

                    ),

                  )}

                </select>

              </label>


              <button

                type="button"

                className="secondary-button"

                onClick={

                  agregarProducto

                }

              >

                + Agregar

              </button>

            </div>


            {/* DETALLE TEMPORAL */}


            <div className="inventory-table-wrapper">

              <table className="inventory-table">

                <thead>

                  <tr>

                    <th>

                      CÓDIGO

                    </th>


                    <th>

                      PRODUCTO

                    </th>


                    <th>

                      UNIDAD

                    </th>


                    <th>

                      CANTIDAD

                    </th>


                    <th>

                      COSTO UNITARIO

                    </th>


                    <th>

                      SUBTOTAL

                    </th>


                    <th />

                  </tr>

                </thead>


                <tbody>

                  {items.length ===

                    0 && (

                    <tr>

                      <td

                        colSpan={

                          7

                        }

                        style={{

                          textAlign:

                            'center',

                          padding:

                            '30px',

                        }}

                      >

                        Agrega productos a la compra.

                      </td>

                    </tr>

                  )}


                  {items.map(

                    item => (

                      <tr

                        key={

                          item.producto_id

                        }

                      >

                        <td>

                          {

                            item.codigo

                          }

                        </td>


                        <td>

                          <strong>

                            {

                              item.nombre

                            }

                          </strong>

                        </td>


                        <td>

                          {

                            item.unidad_medida

                          }

                        </td>


                        <td>

                          <input

                            type="number"

                            min={

                              item.unidad_medida

                                .trim()

                                .toLowerCase() ===

                              'unidad'

                                ? '1'

                                : '0.01'

                            }

                            step={

                              item.unidad_medida

                                .trim()

                                .toLowerCase() ===

                              'unidad'

                                ? '1'

                                : '0.01'

                            }

                            value={

                              item.cantidad

                            }

                            onChange={

                              event =>

                                actualizarItem(

                                  item.producto_id,

                                  'cantidad',

                                  event

                                    .target

                                    .value,

                                )

                            }

                            style={{

                              width:

                                '90px',

                            }}

                          />

                        </td>


                        <td>

                          <input

                            type="number"

                            min="0"

                            step="0.01"

                            value={

                              item.costo_unitario

                            }

                            onChange={

                              event =>

                                actualizarItem(

                                  item.producto_id,

                                  'costo_unitario',

                                  event

                                    .target

                                    .value,

                                )

                            }

                            style={{

                              width:

                                '110px',

                            }}

                          />

                        </td>


                        <td>

                          <strong>

                            {moneda(

                              obtenerSubtotal(

                                item,

                              ),

                            )}

                          </strong>

                        </td>


                        <td>

                          <button

                            type="button"

                            className="secondary-button"

                            onClick={() =>

                              eliminarItem(

                                item.producto_id,

                              )

                            }

                          >

                            Quitar

                          </button>

                        </td>

                      </tr>

                    ),

                  )}

                </tbody>

              </table>

            </div>


            {/* TOTAL */}


            <div

              style={{

                display:

                  'flex',

                alignItems:

                  'center',

                justifyContent:

                  'space-between',

                gap:

                  '20px',

                marginTop:

                  '20px',

              }}

            >

              <div>

                <span

                  style={{

                    display:

                      'block',

                    fontSize:

                      '12.5px',

                    color:

                      '#7b8494',

                    marginBottom:

                      '5px',

                  }}

                >

                  TOTAL DE COMPRA

                </span>


                <strong

                  style={{

                    fontSize:

                      '25px',

                  }}

                >

                  {moneda(

                    totalCompra,

                  )}

                </strong>

              </div>


              <div

                style={{

                  display:

                    'flex',

                  gap:

                    '10px',

                }}

              >

                <button

                  type="button"

                  className="secondary-button"

                  onClick={

                    cancelarCompra

                  }

                  disabled={

                    guardando

                  }

                >

                  Cancelar

                </button>


                <button

                  type="button"

                  className="primary-button"

                  onClick={() =>

                    void registrarCompra()

                  }

                  disabled={

                    guardando

                  }

                >

                  {guardando

                    ? 'Registrando...'

                    : 'Registrar compra'}

                </button>

              </div>

            </div>

          </div>

        </div>

      )}


      {/* ====================================================

          DETALLE DE COMPRA

      ==================================================== */}


      {compraSeleccionada && (

        <div className="inventory-toolbar">

          <div

            style={{

              width:

                '100%',

            }}

          >

            <div

              style={{

                display:

                  'flex',

                justifyContent:

                  'space-between',

                gap:

                  '20px',

                marginBottom:

                  '20px',

              }}

            >

              <div>

                <span className="panel-label">

                  DETALLE DE COMPRA

                </span>


                <h2>

                  {

                    compraSeleccionada

                      .numero

                  }

                </h2>


                <p>

                  {obtenerProveedor(

                    compraSeleccionada

                      .proveedores,

                  )?.nombre ??

                    'Proveedor'}

                </p>

              </div>


              <button

                type="button"

                className="secondary-button"

                onClick={

                  cerrarDetalle

                }

              >

                ✕ Cerrar

              </button>

            </div>


            <div

              style={{

                display:

                  'grid',

                gridTemplateColumns:

                  'repeat(5, minmax(0, 1fr))',

                gap:

                  '14px',

                marginBottom:

                  '20px',

              }}

            >

              <div>

                <span className="panel-label">

                  FECHA

                </span>


                <strong>

                  {

                    compraSeleccionada

                      .fecha_compra

                  }

                </strong>

              </div>


              <div>

                <span className="panel-label">

                  TIPO DE COMPRA

                </span>


                <strong>

                  {etiquetaTipoCompra(

                    compraSeleccionada

                      .tipo_compra,

                  )}

                </strong>

              </div>


              <div>

                <span className="panel-label">

                  REFERENCIA

                </span>


                <strong>

                  {compraSeleccionada

                    .referencia_documento ||

                    '—'}

                </strong>

              </div>


              <div>

                <span className="panel-label">

                  ESTADO

                </span>


                <span

                  className={

                    claseEstadoCompra(

                      compraSeleccionada

                        .estado,

                    )

                  }

                >

                  {etiquetaEstadoCompra(

                    compraSeleccionada

                      .estado,

                  )}

                </span>

              </div>


              <div>

                <span className="panel-label">

                  TOTAL

                </span>


                <strong>

                  {moneda(

                    compraSeleccionada

                      .total,

                  )}

                </strong>

              </div>

            </div>


            {compraSeleccionada

              .autorizada_at && (

              <p

                style={{

                  marginBottom:

                    '18px',

                }}

              >

                Autorizada el:{' '}


                <strong>

                  {new Date(

                    compraSeleccionada

                      .autorizada_at,

                  ).toLocaleString(

                    'es-NI',

                  )}

                </strong>

              </p>

            )}


            {compraSeleccionada

              .observaciones && (

              <p

                style={{

                  marginBottom:

                    '18px',

                }}

              >

                {

                  compraSeleccionada

                    .observaciones

                }

              </p>

            )}


            {compraSeleccionada

              .motivo_anulacion && (

              <div

                className="error-message"

                style={{

                  marginBottom:

                    '18px',

                }}

              >

                Motivo de anulación:{' '}


                {

                  compraSeleccionada

                    .motivo_anulacion

                }

              </div>

            )}


            <div className="inventory-table-wrapper">

              <table className="inventory-table">

                <thead>

                  <tr>

                    <th>

                      CÓDIGO

                    </th>


                    <th>

                      PRODUCTO

                    </th>


                    <th>

                      UNIDAD

                    </th>


                    <th>

                      CANTIDAD

                    </th>


                    <th>

                      COSTO UNITARIO

                    </th>


                    <th>

                      SUBTOTAL

                    </th>

                  </tr>

                </thead>


                <tbody>

                  {cargandoDetalle && (

                    <tr>

                      <td

                        colSpan={

                          6

                        }

                        style={{

                          textAlign:

                            'center',

                          padding:

                            '30px',

                        }}

                      >

                        Cargando detalle...

                      </td>

                    </tr>

                  )}


                  {!cargandoDetalle &&

                    detalles.map(

                      detalle => {

                        const producto =

                          obtenerProductoDetalle(

                            detalle.productos,

                          )


                        return (

                          <tr

                            key={

                              detalle.id

                            }

                          >

                            <td>

                              {producto

                                ?.codigo ??

                                '—'}

                            </td>


                            <td>

                              <strong>

                                {producto

                                  ?.nombre ??

                                  'Producto'}

                              </strong>

                            </td>


                            <td>

                              {producto

                                ?.unidad_medida ??

                                '—'}

                            </td>


                            <td>

                              {

                                detalle.cantidad

                              }

                            </td>


                            <td>

                              {moneda(

                                detalle

                                  .costo_unitario,

                              )}

                            </td>


                            <td>

                              <strong>

                                {moneda(

                                  detalle

                                    .subtotal,

                                )}

                              </strong>

                            </td>

                          </tr>

                        )

                      },

                    )}

                </tbody>

              </table>

            </div>

          </div>

        </div>

      )}


      {/* ====================================================

          HISTORIAL

      ==================================================== */}


      <div

        style={{

          display:

            'flex',

          alignItems:

            'center',

          justifyContent:

            'space-between',

          gap:

            '20px',

        }}

      >

        <input

          type="search"

          className="inventory-search"

          placeholder="⌕  Buscar compra, proveedor, factura..."

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

        />


        <span

          style={{

            fontSize:

              '13px',

            color:

              '#7b8494',

          }}

        >

          {

            comprasFiltradas.length

          }{' '}


          {comprasFiltradas.length ===

          1

            ? 'compra'

            : 'compras'}

        </span>

      </div>


      <div className="inventory-table-wrapper">

        <table className="inventory-table">

          <thead>

            <tr>

              <th>

                NÚMERO

              </th>


              <th>

                FECHA

              </th>


              <th>

                TIPO

              </th>


              <th>

                PROVEEDOR

              </th>


              <th>

                FACTURA / REF.

              </th>


              <th>

                TOTAL

              </th>


              <th>

                ESTADO

              </th>


              <th>

                ACCIONES

              </th>

            </tr>

          </thead>


          <tbody>

            {comprasFiltradas.length ===

              0 && (

              <tr>

                <td

                  colSpan={

                    8

                  }

                  style={{

                    textAlign:

                      'center',

                    padding:

                      '40px',

                  }}

                >

                  No hay compras para mostrar.

                </td>

              </tr>

            )}


            {comprasFiltradas.map(

              compra => {

                const proveedor =

                  obtenerProveedor(

                    compra.proveedores,

                  )


                return (

                  <tr

                    key={

                      compra.id

                    }

                  >

                    <td>

                      <strong>

                        {

                          compra.numero

                        }

                      </strong>

                    </td>


                    <td>

                      {

                        compra.fecha_compra

                      }

                    </td>


                    <td>

                      {etiquetaTipoCompra(

                        compra.tipo_compra,

                      )}

                    </td>


                    <td>

                      <strong>

                        {proveedor

                          ?.nombre ??

                          'Proveedor'}

                      </strong>


                      {proveedor && (

                        <div

                          style={{

                            fontSize:

                              '12.5px',

                            color:

                              '#8a93a3',

                            marginTop:

                              '3px',

                          }}

                        >

                          {

                            proveedor.codigo

                          }

                        </div>

                      )}

                    </td>


                    <td>

                      {compra

                        .referencia_documento ||

                        '—'}

                    </td>


                    <td>

                      <strong>

                        {moneda(

                          compra.total,

                        )}

                      </strong>

                    </td>


                    <td>

                      <span

                        className={

                          claseEstadoCompra(

                            compra.estado,

                          )

                        }

                      >

                        {etiquetaEstadoCompra(

                          compra.estado,

                        )}

                      </span>

                    </td>


                    <td>

                      <div

                        style={{

                          display:

                            'flex',

                          gap:

                            '8px',

                          alignItems:

                            'center',

                          flexWrap:

                            'wrap',

                        }}

                      >

                        <button

                          type="button"

                          className="secondary-button"

                          onClick={() =>

                            void verDetalle(

                              compra,

                            )

                          }

                          disabled={

                            procesandoAccion

                          }

                        >

                          Ver detalle

                        </button>


                        {puedeAutorizar &&

                          compra.estado ===

                            'registrada' && (

                            <button

                              type="button"

                              className="primary-button"

                              onClick={() =>

                                void autorizarCompra(

                                  compra,

                                )

                              }

                              disabled={

                                procesandoAccion

                              }

                            >

                              Autorizar

                            </button>

                          )}


                        {puedeAnular &&

                          (

                            compra.estado ===

                              'registrada' ||

                            compra.estado ===

                              'autorizada'

                          ) && (

                            <button

                              type="button"

                              className="secondary-button"

                              onClick={() =>

                                void anularCompra(

                                  compra,

                                )

                              }

                              disabled={

                                procesandoAccion

                              }

                            >

                              Anular

                            </button>

                          )}

                      </div>

                    </td>

                  </tr>

                )

              },

            )}

          </tbody>

        </table>

      </div>

    </div>

  )

}


export default PurchasesModule