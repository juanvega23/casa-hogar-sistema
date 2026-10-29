import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import { descuentoVigente } from '../lib/descuentos'


type CategoriaRelacion = {
  nombre: string
}

type ExistenciaRelacion = {
  cantidad: number
}

type ProductoRespuesta = {
  id: number
  codigo: string
  nombre: string
  precio_venta: number
  descuento_porcentaje: number
  descuento_hasta: string | null
  activo: boolean

  categorias:
    | CategoriaRelacion
    | CategoriaRelacion[]
    | null

  existencias:
    | ExistenciaRelacion
    | ExistenciaRelacion[]
    | null
}

type ProductoVenta = {
  id: number
  codigo: string
  nombre: string
  categoria: string
  precio: number
  descuento: number
  existencia: number
}

type ItemCarrito = {
  producto: ProductoVenta
  cantidad: number
}

type Cliente = {
  id: number
  codigo: string
  nombre: string
  tipo_cliente: 'natural' | 'juridica'
  identificacion: string | null
  telefono: string | null
  permite_credito: boolean
  limite_credito: number | null
  activo: boolean
}

type ResultadoVenta = {
  venta_id: number
  numero: string
  total: number
  estado:
    | 'pendiente_cobro'
    | 'con_saldo'
    | string
}

type TipoVenta =
  | 'contado'
  | 'credito'

type SalesModuleProps = {
  roleCode: string
}

type VentaConsulta = {
  id: number
  numero: string
  cliente_nombre: string | null
  tipo_venta: 'contado' | 'credito'
  subtotal: number
  descuento: number
  total: number
  estado: string
  referencia: string | null
  created_at: string
}


function obtenerCategoria(
  relacion:
    | CategoriaRelacion
    | CategoriaRelacion[]
    | null,
) {
  if (!relacion) {
    return 'Sin categoría'
  }

  if (Array.isArray(relacion)) {
    return (
      relacion[0]?.nombre ??
      'Sin categoría'
    )
  }

  return relacion.nombre
}


function obtenerExistencia(
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
      relacion[0]?.cantidad ?? 0,
    )
  }

  return Number(
    relacion.cantidad ?? 0,
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


function calcularSubtotalItem(
  item: ItemCarrito,
) {
  const bruto =
    Math.round(
      (
        item.producto.precio *
        item.cantidad
      ) *
      100,
    ) / 100

  const descuento =
    Math.round(
      (
        bruto *
        (
          item.producto.descuento /
          100
        )
      ) *
      100,
    ) / 100

  return bruto - descuento
}


function etiquetaEstado(
  estado: string,
) {
  if (
    estado ===
    'pendiente_cobro'
  ) {
    return 'Pendiente de cobro'
  }

  if (
    estado ===
    'con_saldo'
  ) {
    return 'Con saldo'
  }

  if (estado === 'pagada') {
    return 'Pagada'
  }

  if (estado === 'anulada') {
    return 'Anulada'
  }

  return estado
}


export default function SalesModule({
  roleCode,
}: SalesModuleProps) {
  const esVendedor =
    roleCode === 'vendedor'

  const esConsultaVentas =
    roleCode === 'responsable_comercial' ||
    roleCode === 'gerencia'

  const [
    ventasConsulta,
    setVentasConsulta,
  ] = useState<VentaConsulta[]>([])

  const [
    busquedaVentas,
    setBusquedaVentas,
  ] = useState('')

  /*
   * Anulación: solo Responsable Comercial y solo ventas de
   * contado pendientes de cobro (regla de anular_venta()).
   */
  const puedeAnular =
    roleCode === 'responsable_comercial'

  const [
    ventaAnular,
    setVentaAnular,
  ] = useState<VentaConsulta | null>(null)

  const [
    motivoAnulacion,
    setMotivoAnulacion,
  ] = useState('')

  const [
    exitoConsulta,
    setExitoConsulta,
  ] = useState('')

  const [
    productos,
    setProductos,
  ] = useState<ProductoVenta[]>([])

  const [
    clientes,
    setClientes,
  ] = useState<Cliente[]>([])

  const [
    carrito,
    setCarrito,
  ] = useState<ItemCarrito[]>([])

  const [
    busqueda,
    setBusqueda,
  ] = useState('')

  const [
    tipoVenta,
    setTipoVenta,
  ] =
    useState<TipoVenta>(
      'contado',
    )

  const [
    clienteId,
    setClienteId,
  ] = useState('')

  const [
    referencia,
    setReferencia,
  ] = useState('')

  const [
    fechaVencimiento,
    setFechaVencimiento,
  ] = useState('')

  const [
    cargando,
    setCargando,
  ] = useState(true)

  const [
    procesando,
    setProcesando,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const [
    exito,
    setExito,
  ] = useState('')

  const [
    ultimaVenta,
    setUltimaVenta,
  ] =
    useState<ResultadoVenta | null>(
      null,
    )


  // ==========================================================
  // CARGAR PRODUCTOS
  // ==========================================================

  async function cargarProductos() {
    const { data, error } =
      await supabase
        .from('productos')
        .select(`
          id,
          codigo,
          nombre,
          precio_venta,
          descuento_porcentaje,
          descuento_hasta,
          activo,
          categorias (
            nombre
          ),
          existencias (
            cantidad
          )
        `)
        .eq('activo', true)
        .order(
          'nombre',
          {
            ascending: true,
          },
        )

    if (error) {
      setProductos([])

      throw new Error(
        `No fue posible cargar los productos: ${error.message}`,
      )
    }

    const respuesta =
      (data ??
        []) as unknown as ProductoRespuesta[]

    const lista =
      respuesta.map(
        (
          producto,
        ): ProductoVenta => ({
          id:
            producto.id,

          codigo:
            producto.codigo,

          nombre:
            producto.nombre,

          categoria:
            obtenerCategoria(
              producto.categorias,
            ),

          precio:
            Number(
              producto.precio_venta ??
                0,
            ),

          // Solo el vigente, igual que registrar_venta()
          descuento:
            descuentoVigente(
              Number(
                producto
                  .descuento_porcentaje ??
                  0,
              ),
              producto.descuento_hasta,
            ),

          existencia:
            obtenerExistencia(
              producto.existencias,
            ),
        }),
      )

    setProductos(lista)
  }


  // ==========================================================
  // CARGAR CLIENTES
  // ==========================================================

  async function cargarClientes() {
    const { data, error } =
      await supabase
        .from('clientes')
        .select(`
          id,
          codigo,
          nombre,
          tipo_cliente,
          identificacion,
          telefono,
          permite_credito,
          limite_credito,
          activo
        `)
        .eq('activo', true)
        .order(
          'nombre',
          {
            ascending: true,
          },
        )

    if (error) {
      setClientes([])

      throw new Error(
        `No fue posible cargar los clientes: ${error.message}`,
      )
    }

    setClientes(
      (data ?? []).map(
        (cliente) => ({
          id:
            Number(
              cliente.id,
            ),

          codigo:
            String(
              cliente.codigo,
            ),

          nombre:
            String(
              cliente.nombre,
            ),

          tipo_cliente:
            cliente.tipo_cliente as
              | 'natural'
              | 'juridica',

          identificacion:
            cliente.identificacion,

          telefono:
            cliente.telefono,

          permite_credito:
            Boolean(
              cliente.permite_credito,
            ),

          limite_credito:
            cliente.limite_credito ===
            null
              ? null
              : Number(
                  cliente.limite_credito,
                ),

          activo:
            Boolean(
              cliente.activo,
            ),
        }),
      ),
    )
  }


  // ==========================================================
  // CARGAR VENTAS PARA CONSULTA / SUPERVISIÓN
  // ==========================================================

  async function cargarVentasConsulta() {
    const { data, error } =
      await supabase
        .from('ventas')
        .select(`
          id,
          numero,
          cliente_nombre,
          tipo_venta,
          subtotal,
          descuento,
          total,
          estado,
          referencia,
          created_at
        `)
        .order(
          'created_at',
          {
            ascending: false,
          },
        )

    if (error) {
      setVentasConsulta([])

      throw new Error(
        `No fue posible cargar las ventas: ${error.message}`,
      )
    }

    setVentasConsulta(
      (data ?? []).map(
        (venta) => ({
          id:
            Number(venta.id),

          numero:
            String(venta.numero),

          cliente_nombre:
            venta.cliente_nombre,

          tipo_venta:
            venta.tipo_venta as
              | 'contado'
              | 'credito',

          subtotal:
            Number(
              venta.subtotal ?? 0,
            ),

          descuento:
            Number(
              venta.descuento ?? 0,
            ),

          total:
            Number(
              venta.total ?? 0,
            ),

          estado:
            String(venta.estado),

          referencia:
            venta.referencia,

          created_at:
            String(venta.created_at),
        }),
      ),
    )
  }


  async function cargarDatos() {
    setCargando(true)
    setError('')

    try {
      if (esVendedor) {
        await Promise.all([
          cargarProductos(),
          cargarClientes(),
        ])
      } else if (esConsultaVentas) {
        await cargarVentasConsulta()
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No fue posible cargar la información.',
      )
    } finally {
      setCargando(false)
    }
  }


  useEffect(() => {
    void cargarDatos()
  }, [roleCode])


  // ==========================================================
  // ANULAR VENTA (RESPONSABLE COMERCIAL)
  // La reversión de inventario y el Kardex los realiza
  // anular_venta() dentro de una sola transacción.
  // ==========================================================

  async function anularVenta(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (!ventaAnular || !puedeAnular) {
      return
    }

    if (motivoAnulacion.trim().length < 3) {
      setError(
        'Indica un motivo de anulación de al menos 3 caracteres.',
      )
      return
    }

    setProcesando(true)
    setError('')
    setExitoConsulta('')

    const { error: rpcError } =
      await supabase.rpc(
        'anular_venta',
        {
          p_venta_id: ventaAnular.id,
          p_motivo: motivoAnulacion.trim(),
        },
      )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    setExitoConsulta(
      `Venta ${ventaAnular.numero} anulada. El inventario fue restituido.`,
    )
    setVentaAnular(null)
    setMotivoAnulacion('')
    await cargarDatos()
    setProcesando(false)
  }


  // ==========================================================
  // PRODUCTOS FILTRADOS
  // ==========================================================

  const productosFiltrados =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return productos
      }

      return productos.filter(
        (producto) =>
          producto.codigo
            .toLowerCase()
            .includes(termino) ||
          producto.nombre
            .toLowerCase()
            .includes(termino) ||
          producto.categoria
            .toLowerCase()
            .includes(termino),
      )
    }, [
      productos,
      busqueda,
    ])


  // ==========================================================
  // VENTAS FILTRADAS PARA CONSULTA
  // ==========================================================

  const ventasFiltradas =
    useMemo(() => {
      const termino =
        busquedaVentas
          .trim()
          .toLowerCase()

      if (!termino) {
        return ventasConsulta
      }

      return ventasConsulta.filter(
        (venta) =>
          venta.numero
            .toLowerCase()
            .includes(termino) ||
          (
            venta.cliente_nombre ??
            'cliente general'
          )
            .toLowerCase()
            .includes(termino) ||
          venta.tipo_venta
            .toLowerCase()
            .includes(termino) ||
          venta.estado
            .toLowerCase()
            .includes(termino) ||
          (
            venta.referencia ??
            ''
          )
            .toLowerCase()
            .includes(termino),
      )
    }, [
      ventasConsulta,
      busquedaVentas,
    ])


  // ==========================================================
  // CLIENTE SELECCIONADO
  // ==========================================================

  const clienteSeleccionado =
    useMemo(
      () =>
        clientes.find(
          (cliente) =>
            cliente.id ===
            Number(clienteId),
        ) ?? null,
      [
        clientes,
        clienteId,
      ],
    )


  // ==========================================================
  // TOTAL
  // ==========================================================

  const total =
    useMemo(() => {
      return carrito.reduce(
        (
          acumulado,
          item,
        ) =>
          acumulado +
          calcularSubtotalItem(
            item,
          ),
        0,
      )
    }, [carrito])


  const cantidadItems =
    carrito.reduce(
      (
        totalCantidad,
        item,
      ) =>
        totalCantidad +
        item.cantidad,
      0,
    )


  // ==========================================================
  // AGREGAR PRODUCTO
  // ==========================================================

  function agregarProducto(
    producto: ProductoVenta,
  ) {
    setError('')
    setExito('')
    setUltimaVenta(null)

    if (
      producto.existencia <= 0
    ) {
      setError(
        `${producto.nombre} no tiene existencia disponible.`,
      )

      return
    }

    setCarrito(
      (actual) => {
        const existente =
          actual.find(
            (item) =>
              item.producto.id ===
              producto.id,
          )

        if (existente) {
          if (
            existente.cantidad >=
            producto.existencia
          ) {
            setError(
              `No puedes agregar más unidades de ${producto.nombre}. Existencia disponible: ${producto.existencia}.`,
            )

            return actual
          }

          return actual.map(
            (item) =>
              item.producto.id ===
              producto.id
                ? {
                    ...item,
                    cantidad:
                      item.cantidad +
                      1,
                  }
                : item,
          )
        }

        return [
          ...actual,
          {
            producto,
            cantidad: 1,
          },
        ]
      },
    )
  }


  // ==========================================================
  // CAMBIAR CANTIDAD
  // ==========================================================

  function cambiarCantidad(
    productoId: number,
    nuevaCantidad: number,
  ) {
    setError('')
    setExito('')

    if (
      nuevaCantidad <= 0
    ) {
      setCarrito(
        (actual) =>
          actual.filter(
            (item) =>
              item.producto.id !==
              productoId,
          ),
      )

      return
    }

    setCarrito(
      (actual) =>
        actual.map(
          (item) => {
            if (
              item.producto.id !==
              productoId
            ) {
              return item
            }

            if (
              nuevaCantidad >
              item.producto
                .existencia
            ) {
              setError(
                `Existencia insuficiente para ${item.producto.nombre}. Disponible: ${item.producto.existencia}.`,
              )

              return item
            }

            return {
              ...item,
              cantidad:
                nuevaCantidad,
            }
          },
        ),
    )
  }


  function quitarProducto(
    productoId: number,
  ) {
    setCarrito(
      (actual) =>
        actual.filter(
          (item) =>
            item.producto.id !==
            productoId,
        ),
    )
  }


  // ==========================================================
  // LIMPIAR
  // ==========================================================

  function limpiarVenta() {
    setCarrito([])
    setTipoVenta('contado')
    setClienteId('')
    setReferencia('')
    setFechaVencimiento('')
    setError('')
    setExito('')
    setUltimaVenta(null)
  }


  // ==========================================================
  // REGISTRAR VENTA
  // ==========================================================

  async function registrarVenta() {
    setError('')
    setExito('')
    setUltimaVenta(null)

    if (
      carrito.length === 0
    ) {
      setError(
        'Agrega al menos un producto a la venta.',
      )

      return
    }

    if (total <= 0) {
      setError(
        'El total de la venta debe ser mayor que cero.',
      )

      return
    }

    if (
      tipoVenta ===
        'credito' &&
      !clienteId
    ) {
      setError(
        'Las ventas a crédito deben estar asociadas a un cliente registrado.',
      )

      return
    }

    if (
      tipoVenta ===
        'credito' &&
      !clienteSeleccionado
        ?.permite_credito
    ) {
      setError(
        'El cliente seleccionado no está autorizado para comprar a crédito.',
      )

      return
    }

    if (
      tipoVenta ===
        'credito' &&
      !fechaVencimiento
    ) {
      setError(
        'Debes indicar la fecha de vencimiento de la venta a crédito.',
      )

      return
    }

    setProcesando(true)

    const items =
      carrito.map(
        (item) => ({
          producto_id:
            item.producto.id,

          cantidad:
            item.cantidad,
        }),
      )

    const {
      data,
      error,
    } = await supabase.rpc(
      'registrar_venta',
      {
        p_items:
          items,

        p_tipo_venta:
          tipoVenta,

        p_cliente_id:
          clienteId
            ? Number(
                clienteId,
              )
            : null,

        p_cliente_nombre:
          clienteSeleccionado
            ?.nombre ??
          null,

        p_cotizacion_id:
          null,

        p_fecha_vencimiento:
          tipoVenta ===
          'credito'
            ? fechaVencimiento
            : null,

        p_referencia:
          referencia.trim() ||
          null,
      },
    )

    if (error) {
      setError(
        error.message,
      )

      setProcesando(false)

      return
    }

    const resultado =
      Array.isArray(data)
        ? data[0]
        : data

    if (!resultado) {
      setError(
        'La venta fue registrada, pero no se recibió la respuesta esperada.',
      )

      setProcesando(false)

      return
    }

    const venta:
      ResultadoVenta = {
      venta_id:
        Number(
          resultado.venta_id,
        ),

      numero:
        String(
          resultado.numero,
        ),

      total:
        Number(
          resultado.total,
        ),

      estado:
        String(
          resultado.estado,
        ),
    }

    setUltimaVenta(
      venta,
    )

    setExito(
      `Venta ${venta.numero} registrada correctamente.`,
    )

    setCarrito([])
    setTipoVenta('contado')
    setClienteId('')
    setReferencia('')
    setFechaVencimiento('')

    await cargarProductos()

    setProcesando(false)
  }


  // ==========================================================
  // CARGANDO
  // ==========================================================

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando ventas...
        </span>
      </div>
    )
  }


  // ==========================================================
  // CONSULTA / SUPERVISIÓN DE VENTAS
  // Responsable Comercial y Gerencia
  // ==========================================================

  if (esConsultaVentas) {
    const ventasPagadas =
      ventasConsulta.filter(
        (venta) =>
          venta.estado === 'pagada',
      ).length

    const ventasPendientes =
      ventasConsulta.filter(
        (venta) =>
          venta.estado ===
            'pendiente_cobro' ||
          venta.estado ===
            'con_saldo',
      ).length

    const ventasAnuladas =
      ventasConsulta.filter(
        (venta) =>
          venta.estado === 'anulada',
      ).length

    return (
      <div className="sales-module">

        <div className="sales-toolbar">
          <div>
            <span className="panel-label">
              VENTAS
            </span>

            <h2>
              Ventas registradas
            </h2>

            <p>
              Consulta y supervisa las
              ventas registradas.
              Esta vista no permite
              registrar nuevas ventas.
            </p>
          </div>

          <button
            type="button"
            className="inventory-refresh-button"
            onClick={
              cargarDatos
            }
          >
            ↻ Actualizar
          </button>
        </div>


        <div className="sales-summary-grid">

          <article className="sales-summary-card">
            <span>
              TOTAL
            </span>

            <strong>
              {ventasConsulta.length}
            </strong>

            <p>
              ventas registradas
            </p>
          </article>


          <article className="sales-summary-card">
            <span>
              PAGADAS
            </span>

            <strong>
              {ventasPagadas}
            </strong>

            <p>
              ventas pagadas
            </p>
          </article>


          <article className="sales-summary-card">
            <span>
              PENDIENTES
            </span>

            <strong>
              {ventasPendientes}
            </strong>

            <p>
              pendientes o con saldo
            </p>
          </article>


          <article className="sales-summary-card">
            <span>
              ANULADAS
            </span>

            <strong>
              {ventasAnuladas}
            </strong>

            <p>
              ventas anuladas
            </p>
          </article>

        </div>


        {error && (
          <div className="inventory-error">
            {error}
          </div>
        )}

        {exitoConsulta && (
          <div className="movement-success">
            {exitoConsulta}
          </div>
        )}


        {ventaAnular && (
          <section className="cash-card">
            <div className="cash-section-head">
              <div>
                <span className="panel-label">
                  ANULACIÓN
                </span>

                <h3>
                  Anular venta {ventaAnular.numero} ·{' '}
                  {formatearCordobas(
                    ventaAnular.total,
                  )}
                </h3>
              </div>

              <button
                type="button"
                className="product-close-button"
                onClick={() => {
                  setVentaAnular(null)
                  setMotivoAnulacion('')
                }}
              >
                ×
              </button>
            </div>

            <p className="cash-help">
              Los productos regresarán al inventario y la venta dejará de estar pendiente de cobro en Caja.
            </p>

            <form
              className="cash-form"
              onSubmit={anularVenta}
            >
              <label className="cash-field-full">
                Motivo de anulación
                <textarea
                  value={motivoAnulacion}
                  onChange={(event) =>
                    setMotivoAnulacion(
                      event.target.value,
                    )
                  }
                  placeholder="Ej.: el cliente desistió de la compra"
                />
              </label>

              <div className="cash-actions cash-field-full">
                <button
                  type="submit"
                  className="product-primary-button"
                  disabled={procesando}
                >
                  {procesando
                    ? 'Anulando...'
                    : 'Confirmar anulación'}
                </button>
              </div>
            </form>
          </section>
        )}


        <section className="sales-products-panel">

          <div className="sales-panel-head">
            <div>
              <span className="panel-label">
                CONSULTA
              </span>

              <h3>
                Ventas
              </h3>
            </div>

            <span className="sales-result-count">
              {ventasFiltradas.length}{' '}
              resultado
              {ventasFiltradas.length ===
              1
                ? ''
                : 's'}
            </span>
          </div>


          <div className="sales-search">
            <span>
              ⌕
            </span>

            <input
              type="text"
              value={
                busquedaVentas
              }
              onChange={(
                event,
              ) =>
                setBusquedaVentas(
                  event.target.value,
                )
              }
              placeholder="Buscar por número, cliente, tipo, estado o referencia..."
            />
          </div>


          <div className="sales-product-list">

            {ventasFiltradas.length >
            0 ? (
              ventasFiltradas.map(
                (venta) => (
                  <article
                    className="sales-product-row"
                    key={
                      venta.id
                    }
                  >

                    <div className="sales-product-main">
                      <span className="product-code">
                        {venta.numero}
                      </span>

                      <strong>
                        {venta.cliente_nombre ??
                          'Cliente general'}
                      </strong>

                      <small>
                        {new Date(
                          venta.created_at,
                        ).toLocaleString(
                          'es-NI',
                        )}
                      </small>
                    </div>


                    <div className="sales-product-stock">
                      <span>
                        Tipo
                      </span>

                      <strong>
                        {venta.tipo_venta ===
                        'credito'
                          ? 'Crédito'
                          : 'Contado'}
                      </strong>
                    </div>


                    <div className="sales-product-price">
                      <span>
                        Total
                      </span>

                      <strong>
                        {formatearCordobas(
                          venta.total,
                        )}
                      </strong>
                    </div>


                    <div className="sales-product-price">
                      <span>
                        Estado
                      </span>

                      <strong>
                        {etiquetaEstado(
                          venta.estado,
                        )}
                      </strong>
                    </div>


                    {puedeAnular &&
                      venta.tipo_venta ===
                        'contado' &&
                      venta.estado ===
                        'pendiente_cobro' && (
                        <button
                          type="button"
                          className="product-edit-button"
                          disabled={procesando}
                          onClick={() => {
                            setError('')
                            setExitoConsulta('')
                            setMotivoAnulacion('')
                            setVentaAnular(venta)
                          }}
                        >
                          Anular
                        </button>
                      )}

                  </article>
                ),
              )
            ) : (
              <div className="inventory-empty">
                No se encontraron ventas.
              </div>
            )}

          </div>

        </section>

      </div>
    )
  }


  if (!esVendedor) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso
        a la operación de ventas.
      </div>
    )
  }


  return (
    <div className="sales-module">

      {/* =============================================
          ENCABEZADO
      ============================================= */}

      <div className="sales-toolbar">
        <div>
          <span className="panel-label">
            VENTAS
          </span>

          <h2>
            Registrar venta
          </h2>

          <p>
            Selecciona los productos y
            registra la operación.
            El cobro se realizará
            posteriormente desde Caja.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={
            cargarDatos
          }
        >
          ↻ Actualizar
        </button>
      </div>


      {/* =============================================
          RESUMEN
      ============================================= */}

      <div className="sales-summary-grid">

        <article className="sales-summary-card">
          <span>
            PRODUCTOS
          </span>

          <strong>
            {productos.length}
          </strong>

          <p>
            disponibles en catálogo
          </p>
        </article>


        <article className="sales-summary-card">
          <span>
            EN CARRITO
          </span>

          <strong>
            {cantidadItems}
          </strong>

          <p>
            unidades
          </p>
        </article>


        <article className="sales-summary-card">
          <span>
            TOTAL
          </span>

          <strong>
            {formatearCordobas(
              total,
            )}
          </strong>

          <p>
            venta actual
          </p>
        </article>


        <article className="sales-summary-card">
          <span>
            TIPO
          </span>

          <strong>
            {tipoVenta ===
            'credito'
              ? 'Crédito'
              : 'Contado'}
          </strong>

          <p>
            modalidad de venta
          </p>
        </article>

      </div>


      {/* =============================================
          MENSAJES
      ============================================= */}

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

      {ultimaVenta && (
        <section className="sales-success-card">

          <div className="sales-success-icon">
            ✓
          </div>

          <div>
            <span>
              VENTA REGISTRADA
            </span>

            <h3>
              {ultimaVenta.numero}
            </h3>

            <p>
              Total{' '}
              <strong>
                {formatearCordobas(
                  ultimaVenta.total,
                )}
              </strong>

              {' · '}

              Estado{' '}

              <strong>
                {etiquetaEstado(
                  ultimaVenta.estado,
                )}
              </strong>
            </p>
          </div>

        </section>
      )}


      {/* =============================================
          PRODUCTOS Y CARRITO
      ============================================= */}

      <div className="sales-workspace">

        <section className="sales-products-panel">

          <div className="sales-panel-head">
            <div>
              <span className="panel-label">
                CATÁLOGO
              </span>

              <h3>
                Productos
              </h3>
            </div>

            <span className="sales-result-count">
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


          <div className="sales-search">
            <span>
              ⌕
            </span>

            <input
              type="text"
              value={
                busqueda
              }
              onChange={(
                event,
              ) =>
                setBusqueda(
                  event.target
                    .value,
                )
              }
              placeholder="Buscar por código, producto o categoría..."
            />
          </div>


          <div className="sales-product-list">

            {productosFiltrados.length >
            0 ? (
              productosFiltrados.map(
                (producto) => {
                  const sinExistencia =
                    producto.existencia <=
                    0

                  const precioFinal =
                    producto.precio *
                    (
                      1 -
                      producto.descuento /
                        100
                    )

                  return (
                    <article
                      className="sales-product-row"
                      key={
                        producto.id
                      }
                    >

                      <div className="sales-product-main">

                        <span className="product-code">
                          {
                            producto.codigo
                          }
                        </span>

                        <strong>
                          {
                            producto.nombre
                          }
                        </strong>

                        <small>
                          {
                            producto.categoria
                          }
                        </small>

                        {producto.descuento >
                          0 && (
                          <small>
                            Descuento:{' '}
                            {
                              producto.descuento
                            }
                            %
                          </small>
                        )}

                      </div>


                      <div className="sales-product-stock">
                        <span>
                          Existencia
                        </span>

                        <strong
                          className={
                            sinExistencia
                              ? 'sales-stock sales-stock--empty'
                              : 'sales-stock'
                          }
                        >
                          {
                            producto.existencia
                          }
                        </strong>
                      </div>


                      <div className="sales-product-price">
                        <span>
                          Precio
                        </span>

                        <strong>
                          {formatearCordobas(
                            precioFinal,
                          )}
                        </strong>
                      </div>


                      <button
                        type="button"
                        className="sales-add-button"
                        disabled={
                          sinExistencia
                        }
                        onClick={() =>
                          agregarProducto(
                            producto,
                          )
                        }
                      >
                        {sinExistencia
                          ? 'Sin stock'
                          : '+ Agregar'}
                      </button>

                    </article>
                  )
                },
              )
            ) : (
              <div className="inventory-empty">
                No se encontraron
                productos.
              </div>
            )}

          </div>

        </section>


        {/* ===========================================
            CARRITO
        =========================================== */}

        <section className="sales-cart-panel">

          <div className="sales-panel-head">

            <div>
              <span className="panel-label">
                VENTA ACTUAL
              </span>

              <h3>
                Carrito
              </h3>
            </div>

            {carrito.length >
              0 && (
              <button
                type="button"
                className="sales-clear-button"
                onClick={
                  limpiarVenta
                }
              >
                Limpiar
              </button>
            )}

          </div>


          <div className="sales-cart-items">

            {carrito.length ===
            0 ? (

              <div className="sales-cart-empty">

                <div>
                  🛒
                </div>

                <strong>
                  Venta vacía
                </strong>

                <p>
                  Agrega productos
                  desde el catálogo.
                </p>

              </div>

            ) : (

              carrito.map(
                (item) => (
                  <article
                    className="sales-cart-item"
                    key={
                      item.producto.id
                    }
                  >

                    <div className="sales-cart-product">

                      <strong>
                        {
                          item.producto
                            .nombre
                        }
                      </strong>

                      <span>
                        {
                          item.producto
                            .codigo
                        }
                      </span>

                      <small>
                        {formatearCordobas(
                          item.producto
                            .precio *
                          (
                            1 -
                            item.producto
                              .descuento /
                              100
                          ),
                        )}{' '}
                        c/u
                      </small>

                    </div>


                    <div className="sales-qty">

                      <button
                        type="button"
                        onClick={() =>
                          cambiarCantidad(
                            item.producto
                              .id,
                            item.cantidad -
                              1,
                          )
                        }
                      >
                        −
                      </button>


                      <input
                        type="number"
                        min="1"
                        max={
                          item.producto
                            .existencia
                        }
                        value={
                          item.cantidad
                        }
                        onChange={(
                          event,
                        ) =>
                          cambiarCantidad(
                            item.producto
                              .id,
                            Number(
                              event
                                .target
                                .value,
                            ),
                          )
                        }
                      />


                      <button
                        type="button"
                        onClick={() =>
                          cambiarCantidad(
                            item.producto
                              .id,
                            item.cantidad +
                              1,
                          )
                        }
                      >
                        +
                      </button>

                    </div>


                    <div className="sales-cart-subtotal">

                      <span>
                        Subtotal
                      </span>

                      <strong>
                        {formatearCordobas(
                          calcularSubtotalItem(
                            item,
                          ),
                        )}
                      </strong>

                    </div>


                    <button
                      type="button"
                      className="sales-remove-button"
                      onClick={() =>
                        quitarProducto(
                          item.producto
                            .id,
                        )
                      }
                    >
                      ×
                    </button>

                  </article>
                ),
              )

            )}

          </div>


          <div className="sales-cart-total">

            <span>
              Total de venta
            </span>

            <strong>
              {formatearCordobas(
                total,
              )}
            </strong>

          </div>

        </section>

      </div>


      {/* =============================================
          DATOS DE LA VENTA
      ============================================= */}

      <section className="sales-payment-card">

        <div className="sales-payment-head">

          <div>
            <span className="panel-label">
              OPERACIÓN
            </span>

            <h3>
              Confirmar venta
            </h3>

            <p>
              Define el tipo de venta,
              el cliente y registra
              la operación.
            </p>
          </div>

          <strong className="sales-payment-total">
            {formatearCordobas(
              total,
            )}
          </strong>

        </div>


        <div className="sales-payment-grid">


          {/* TIPO DE VENTA */}

          <div className="sales-field">

            <label htmlFor="venta-tipo">
              Tipo de venta
            </label>

            <select
              id="venta-tipo"
              value={
                tipoVenta
              }
              onChange={(
                event,
              ) => {
                const valor =
                  event.target
                    .value as TipoVenta

                setTipoVenta(
                  valor,
                )

                if (
                  valor ===
                  'contado'
                ) {
                  setFechaVencimiento(
                    '',
                  )
                }
              }}
            >

              <option value="contado">
                Contado
              </option>

              <option value="credito">
                Crédito
              </option>

            </select>

          </div>


          {/* CLIENTE */}

          <div className="sales-field">

            <label htmlFor="venta-cliente">
              Cliente
            </label>

            <select
              id="venta-cliente"
              value={
                clienteId
              }
              onChange={(
                event,
              ) =>
                setClienteId(
                  event.target
                    .value,
                )
              }
            >

              <option value="">
                Cliente general
              </option>

              {clientes.map(
                (cliente) => (
                  <option
                    key={
                      cliente.id
                    }
                    value={
                      cliente.id
                    }
                  >
                    {
                      cliente.codigo
                    }
                    {' - '}
                    {
                      cliente.nombre
                    }
                  </option>
                ),
              )}

            </select>

          </div>


          {/* REFERENCIA */}

          <div className="sales-field">

            <label htmlFor="venta-referencia">
              Referencia
            </label>

            <input
              id="venta-referencia"
              type="text"
              value={
                referencia
              }
              onChange={(
                event,
              ) =>
                setReferencia(
                  event.target
                    .value,
                )
              }
              placeholder="Opcional"
            />

          </div>


          {/* VENCIMIENTO */}

          <div className="sales-field">

            <label htmlFor="venta-vencimiento">
              Fecha de vencimiento
            </label>

            <input
              id="venta-vencimiento"
              type="date"
              min={
                fechaLocalActual()
              }
              value={
                fechaVencimiento
              }
              disabled={
                tipoVenta !==
                'credito'
              }
              onChange={(
                event,
              ) =>
                setFechaVencimiento(
                  event.target
                    .value,
                )
              }
            />

          </div>

        </div>


        {/* INFORMACIÓN DE CRÉDITO */}

        {tipoVenta ===
          'credito' &&
          clienteSeleccionado && (

          <div className="sales-payment-summary">

            <div>
              <span>
                Cliente
              </span>

              <strong>
                {
                  clienteSeleccionado
                    .nombre
                }
              </strong>
            </div>


            <div>
              <span>
                Crédito autorizado
              </span>

              <strong>
                {clienteSeleccionado
                  .permite_credito
                  ? 'Sí'
                  : 'No'}
              </strong>
            </div>


            <div>
              <span>
                Límite
              </span>

              <strong>
                {clienteSeleccionado
                  .limite_credito !==
                null
                  ? formatearCordobas(
                      clienteSeleccionado
                        .limite_credito,
                    )
                  : 'Sin límite definido'}
              </strong>
            </div>

          </div>

        )}


        {/* RESUMEN */}

        <div className="sales-payment-summary">

          <div>
            <span>
              Total
            </span>

            <strong>
              {formatearCordobas(
                total,
              )}
            </strong>
          </div>


          <div>
            <span>
              Modalidad
            </span>

            <strong>
              {tipoVenta ===
              'credito'
                ? 'Crédito'
                : 'Contado'}
            </strong>
          </div>


          <div>
            <span>
              Estado inicial
            </span>

            <strong>
              {tipoVenta ===
              'credito'
                ? 'Con saldo'
                : 'Pendiente de cobro'}
            </strong>
          </div>

        </div>


        <div className="sales-payment-actions">

          <button
            type="button"
            className="product-secondary-button"
            onClick={
              limpiarVenta
            }
            disabled={
              procesando
            }
          >
            Cancelar venta
          </button>


          <button
            type="button"
            className="sales-confirm-button"
            onClick={
              registrarVenta
            }
            disabled={
              procesando ||
              carrito.length ===
                0
            }
          >
            {procesando
              ? 'Registrando...'
              : `Registrar venta · ${formatearCordobas(total)}`}
          </button>

        </div>

      </section>

    </div>
  )
}