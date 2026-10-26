import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'


type QuotesModuleProps = {
  roleCode: string
}


type Cliente = {
  id: number
  codigo: string
  nombre: string
}


type Producto = {
  id: number
  codigo: string
  nombre: string
  precio_venta: number
}


type Cotizacion = {
  id: number
  numero: string
  cliente_id: number | null
  cliente_nombre: string | null
  subtotal: number
  descuento: number
  total: number
  estado:
    | 'borrador'
    | 'emitida'
    | 'aceptada'
    | 'rechazada'
    | 'vencida'
    | 'convertida'
    | string
  vigencia_hasta: string | null
  observaciones: string | null
  created_at: string
}


type ItemCotizacion = {
  producto_id: number
  codigo: string
  nombre: string
  cantidad: number
  precio_unitario: number
}


type DetalleRespuesta = {
  producto_id: number
  cantidad: number
  precio_unitario: number
  productos:
    | {
        codigo: string
        nombre: string
      }
    | {
        codigo: string
        nombre: string
      }[]
    | null
}


function formatearCordobas(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}


function formatearFecha(valor: string | null) {
  if (!valor) {
    return 'Sin definir'
  }

  const fecha = new Date(`${valor}T00:00:00`)
  return new Intl.DateTimeFormat('es-NI').format(fecha)
}


function fechaPorDefecto() {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() + 7)

  return fecha.toISOString().slice(0, 10)
}


function etiquetaEstado(estado: string) {
  const etiquetas: Record<string, string> = {
    borrador: 'Borrador',
    emitida: 'Emitida',
    aceptada: 'Aceptada',
    rechazada: 'Rechazada',
    vencida: 'Vencida',
    convertida: 'Convertida',
  }

  return etiquetas[estado] ?? estado
}


function claseEstado(estado: string) {
  if (
    estado === 'aceptada' ||
    estado === 'convertida'
  ) {
    return 'quote-status quote-status--ok'
  }

  if (
    estado === 'rechazada' ||
    estado === 'vencida'
  ) {
    return 'quote-status quote-status--danger'
  }

  if (estado === 'emitida') {
    return 'quote-status quote-status--info'
  }

  return 'quote-status'
}


function relacionProducto(
  relacion: DetalleRespuesta['productos'],
) {
  if (!relacion) {
    return {
      codigo: '',
      nombre: 'Producto',
    }
  }

  return Array.isArray(relacion)
    ? relacion[0] ?? {
        codigo: '',
        nombre: 'Producto',
      }
    : relacion
}


export default function QuotesModule({
  roleCode,
}: QuotesModuleProps) {
  const puedeGestionar =
    roleCode === 'vendedor'

  const puedeConsultar =
    puedeGestionar ||
    roleCode === 'responsable_comercial' ||
    roleCode === 'gerencia'

  const [cotizaciones, setCotizaciones] =
    useState<Cotizacion[]>([])

  const [clientes, setClientes] =
    useState<Cliente[]>([])

  const [productos, setProductos] =
    useState<Producto[]>([])

  const [items, setItems] =
    useState<ItemCotizacion[]>([])

  const [busqueda, setBusqueda] =
    useState('')

  const [mostrarFormulario, setMostrarFormulario] =
    useState(false)

  const [editando, setEditando] =
    useState<Cotizacion | null>(null)

  const [clienteId, setClienteId] =
    useState('')

  const [clienteNombre, setClienteNombre] =
    useState('')

  const [vigenciaHasta, setVigenciaHasta] =
    useState(fechaPorDefecto())

  const [observaciones, setObservaciones] =
    useState('')

  const [productoSeleccionado, setProductoSeleccionado] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [procesando, setProcesando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [exito, setExito] =
    useState('')


  const totalFormulario =
    useMemo(
      () =>
        items.reduce(
          (total, item) =>
            total +
            item.cantidad *
              item.precio_unitario,
          0,
        ),
      [items],
    )


  const cotizacionesFiltradas =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return cotizaciones
      }

      return cotizaciones.filter(
        cotizacion =>
          cotizacion.numero
            .toLowerCase()
            .includes(termino) ||
          (
            cotizacion.cliente_nombre ??
            ''
          )
            .toLowerCase()
            .includes(termino) ||
          cotizacion.estado
            .toLowerCase()
            .includes(termino),
      )
    }, [
      cotizaciones,
      busqueda,
    ])


  const resumen = useMemo(() => {
    return {
      total: cotizaciones.length,
      borradores:
        cotizaciones.filter(
          item =>
            item.estado === 'borrador',
        ).length,
      emitidas:
        cotizaciones.filter(
          item =>
            item.estado === 'emitida',
        ).length,
      aceptadas:
        cotizaciones.filter(
          item =>
            item.estado === 'aceptada' ||
            item.estado === 'convertida',
        ).length,
    }
  }, [cotizaciones])


  async function cargarDatos() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const [
      cotizacionesRespuesta,
      clientesRespuesta,
      productosRespuesta,
    ] = await Promise.all([
      supabase
        .from('cotizaciones')
        .select(`
          id,
          numero,
          cliente_id,
          cliente_nombre,
          subtotal,
          descuento,
          total,
          estado,
          vigencia_hasta,
          observaciones,
          created_at
        `)
        .order('created_at', {
          ascending: false,
        }),

      supabase
        .from('clientes')
        .select(`
          id,
          codigo,
          nombre
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase
        .from('productos')
        .select(`
          id,
          codigo,
          nombre,
          precio_venta
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),
    ])

    if (cotizacionesRespuesta.error) {
      setError(
        cotizacionesRespuesta.error.message,
      )
      setCotizaciones([])
      setCargando(false)
      return
    }

    if (clientesRespuesta.error) {
      setError(
        clientesRespuesta.error.message,
      )
      setCargando(false)
      return
    }

    if (productosRespuesta.error) {
      setError(
        productosRespuesta.error.message,
      )
      setCargando(false)
      return
    }

    setCotizaciones(
      (cotizacionesRespuesta.data ??
        []).map(item => ({
        id: Number(item.id),
        numero: String(item.numero),
        cliente_id:
          item.cliente_id === null
            ? null
            : Number(item.cliente_id),
        cliente_nombre:
          item.cliente_nombre,
        subtotal: Number(
          item.subtotal ?? 0,
        ),
        descuento: Number(
          item.descuento ?? 0,
        ),
        total: Number(
          item.total ?? 0,
        ),
        estado: String(
          item.estado,
        ),
        vigencia_hasta:
          item.vigencia_hasta,
        observaciones:
          item.observaciones,
        created_at:
          String(item.created_at),
      })),
    )

    setClientes(
      (clientesRespuesta.data ??
        []).map(item => ({
        id: Number(item.id),
        codigo: String(item.codigo),
        nombre: String(item.nombre),
      })),
    )

    setProductos(
      (productosRespuesta.data ??
        []).map(item => ({
        id: Number(item.id),
        codigo: String(item.codigo),
        nombre: String(item.nombre),
        precio_venta: Number(
          item.precio_venta ?? 0,
        ),
      })),
    )

    setCargando(false)
  }


  useEffect(() => {
    void cargarDatos()
  }, [roleCode])


  function limpiarFormulario() {
    setEditando(null)
    setClienteId('')
    setClienteNombre('')
    setVigenciaHasta(
      fechaPorDefecto(),
    )
    setObservaciones('')
    setProductoSeleccionado('')
    setItems([])
    setError('')
  }


  function abrirNueva() {
    limpiarFormulario()
    setMostrarFormulario(true)
  }


  async function editarCotizacion(
    cotizacion: Cotizacion,
  ) {
    if (
      !puedeGestionar ||
      cotizacion.estado !== 'borrador'
    ) {
      return
    }

    setProcesando(true)
    setError('')
    setExito('')

    const {
      data,
      error: detalleError,
    } =
      await supabase
        .from('detalle_cotizaciones')
        .select(`
          producto_id,
          cantidad,
          precio_unitario,
          productos (
            codigo,
            nombre
          )
        `)
        .eq(
          'cotizacion_id',
          cotizacion.id,
        )

    if (detalleError) {
      setError(detalleError.message)
      setProcesando(false)
      return
    }

    const detalle =
      (data ??
        []) as unknown as DetalleRespuesta[]

    setItems(
      detalle.map(item => {
        const producto =
          relacionProducto(
            item.productos,
          )

        return {
          producto_id:
            Number(
              item.producto_id,
            ),
          codigo:
            producto.codigo,
          nombre:
            producto.nombre,
          cantidad:
            Number(
              item.cantidad,
            ),
          precio_unitario:
            Number(
              item.precio_unitario,
            ),
        }
      }),
    )

    setEditando(cotizacion)
    setClienteId(
      cotizacion.cliente_id
        ? String(
            cotizacion.cliente_id,
          )
        : '',
    )
    setClienteNombre(
      cotizacion.cliente_nombre ??
      '',
    )
    setVigenciaHasta(
      cotizacion.vigencia_hasta ??
      fechaPorDefecto(),
    )
    setObservaciones(
      cotizacion.observaciones ??
      '',
    )
    setMostrarFormulario(true)
    setProcesando(false)
  }


  function agregarProducto() {
    const id =
      Number(productoSeleccionado)

    const producto =
      productos.find(
        item =>
          item.id === id,
      )

    if (!producto) {
      return
    }

    setItems(actual => {
      const existente =
        actual.find(
          item =>
            item.producto_id ===
            producto.id,
        )

      if (existente) {
        return actual.map(item =>
          item.producto_id ===
          producto.id
            ? {
                ...item,
                cantidad:
                  item.cantidad + 1,
              }
            : item,
        )
      }

      return [
        ...actual,
        {
          producto_id:
            producto.id,
          codigo:
            producto.codigo,
          nombre:
            producto.nombre,
          cantidad: 1,
          precio_unitario:
            producto.precio_venta,
        },
      ]
    })

    setProductoSeleccionado('')
  }


  function actualizarItem(
    productoId: number,
    campo:
      | 'cantidad'
      | 'precio_unitario',
    valor: number,
  ) {
    if (valor < 0) {
      return
    }

    setItems(actual =>
      actual.map(item =>
        item.producto_id ===
        productoId
          ? {
              ...item,
              [campo]:
                campo === 'cantidad'
                  ? Math.max(
                      1,
                      valor,
                    )
                  : valor,
            }
          : item,
      ),
    )
  }


  function quitarItem(
    productoId: number,
  ) {
    setItems(actual =>
      actual.filter(
        item =>
          item.producto_id !==
          productoId,
      ),
    )
  }


  async function guardarCotizacion(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (!puedeGestionar) {
      return
    }

    setError('')
    setExito('')

    if (items.length === 0) {
      setError(
        'Agrega al menos un producto a la cotización.',
      )
      return
    }

    if (
      !clienteId &&
      !clienteNombre.trim()
    ) {
      setError(
        'Selecciona un cliente o escribe el nombre del cliente.',
      )
      return
    }

    const cliente =
      clientes.find(
        item =>
          item.id ===
          Number(clienteId),
      )

    const nombre =
      cliente?.nombre ??
      clienteNombre.trim()

    const total =
      Math.round(
        totalFormulario * 100,
      ) / 100

    setProcesando(true)

    if (editando) {
      const {
        error: cabeceraError,
      } =
        await supabase
          .from('cotizaciones')
          .update({
            cliente_id:
              cliente?.id ?? null,
            cliente_nombre:
              nombre,
            subtotal: total,
            descuento: 0,
            total,
            vigencia_hasta:
              vigenciaHasta ||
              null,
            observaciones:
              observaciones.trim() ||
              null,
          })
          .eq(
            'id',
            editando.id,
          )

      if (cabeceraError) {
        setError(
          cabeceraError.message,
        )
        setProcesando(false)
        return
      }

      const {
        error: borrarError,
      } =
        await supabase
          .from('detalle_cotizaciones')
          .delete()
          .eq(
            'cotizacion_id',
            editando.id,
          )

      if (borrarError) {
        setError(
          borrarError.message,
        )
        setProcesando(false)
        return
      }

      const {
        error: detalleError,
      } =
        await supabase
          .from('detalle_cotizaciones')
          .insert(
            items.map(item => ({
              cotizacion_id:
                editando.id,
              producto_id:
                item.producto_id,
              cantidad:
                item.cantidad,
              precio_unitario:
                item.precio_unitario,
              subtotal:
                Math.round(
                  (
                    item.cantidad *
                    item.precio_unitario
                  ) *
                    100,
                ) / 100,
            })),
          )

      if (detalleError) {
        setError(
          detalleError.message,
        )
        setProcesando(false)
        return
      }

      setExito(
        `Cotización ${editando.numero} actualizada correctamente.`,
      )
    } else {
      const {
        data: usuarioRespuesta,
        error: usuarioError,
      } =
        await supabase.auth
          .getUser()

      if (
        usuarioError ||
        !usuarioRespuesta.user
      ) {
        setError(
          'No fue posible identificar al usuario actual.',
        )
        setProcesando(false)
        return
      }

      const numeroTemporal =
        `TMP-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`

      const {
        data: nueva,
        error: crearError,
      } =
        await supabase
          .from('cotizaciones')
          .insert({
            numero:
              numeroTemporal,
            cliente_id:
              cliente?.id ?? null,
            cliente_nombre:
              nombre,
            subtotal: total,
            descuento: 0,
            total,
            estado:
              'borrador',
            vigencia_hasta:
              vigenciaHasta ||
              null,
            observaciones:
              observaciones.trim() ||
              null,
            creada_por:
              usuarioRespuesta.user.id,
          })
          .select(
            'id',
          )
          .single()

      if (
        crearError ||
        !nueva
      ) {
        setError(
          crearError?.message ??
          'No fue posible crear la cotización.',
        )
        setProcesando(false)
        return
      }

      const cotizacionId =
        Number(nueva.id)

      const numero =
        `COT-${String(
          cotizacionId,
        ).padStart(6, '0')}`

      const {
        error: numeroError,
      } =
        await supabase
          .from('cotizaciones')
          .update({
            numero,
          })
          .eq(
            'id',
            cotizacionId,
          )

      if (numeroError) {
        setError(
          numeroError.message,
        )
        setProcesando(false)
        return
      }

      const {
        error: detalleError,
      } =
        await supabase
          .from('detalle_cotizaciones')
          .insert(
            items.map(item => ({
              cotizacion_id:
                cotizacionId,
              producto_id:
                item.producto_id,
              cantidad:
                item.cantidad,
              precio_unitario:
                item.precio_unitario,
              subtotal:
                Math.round(
                  (
                    item.cantidad *
                    item.precio_unitario
                  ) *
                    100,
                ) / 100,
            })),
          )

      if (detalleError) {
        setError(
          detalleError.message,
        )
        setProcesando(false)
        return
      }

      setExito(
        `Cotización ${numero} creada correctamente.`,
      )
    }

    setMostrarFormulario(false)
    limpiarFormulario()
    await cargarDatos()
    setProcesando(false)
  }


  async function emitirCotizacion(
    cotizacion: Cotizacion,
  ) {
    if (
      !puedeGestionar ||
      cotizacion.estado !== 'borrador'
    ) {
      return
    }

    setProcesando(true)
    setError('')
    setExito('')

    const { error } =
      await supabase
        .from('cotizaciones')
        .update({
          estado: 'emitida',
        })
        .eq(
          'id',
          cotizacion.id,
        )

    if (error) {
      setError(error.message)
      setProcesando(false)
      return
    }

    setExito(
      `Cotización ${cotizacion.numero} emitida correctamente.`,
    )

    await cargarDatos()
    setProcesando(false)
  }


  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso a cotizaciones.
      </div>
    )
  }


  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>
          Cargando cotizaciones...
        </span>
      </div>
    )
  }


  return (
    <div className="quotes-module">

      <section className="quotes-toolbar">
        <div>
          <span className="panel-label">
            COTIZACIONES
          </span>

          <h2>
            {puedeGestionar
              ? 'Gestión de cotizaciones'
              : 'Consulta de cotizaciones'}
          </h2>

          <p>
            {puedeGestionar
              ? 'Elabora cotizaciones y administra sus productos antes de emitirlas.'
              : 'Consulta las cotizaciones registradas y su estado comercial.'}
          </p>
        </div>

        <div className="quotes-toolbar-actions">
          <button
            type="button"
            className="inventory-refresh-button"
            onClick={() =>
              void cargarDatos()
            }
          >
            ↻ Actualizar
          </button>

          {puedeGestionar && (
            <button
              type="button"
              className="product-primary-button"
              onClick={abrirNueva}
            >
              + Nueva cotización
            </button>
          )}
        </div>
      </section>


      <div className="quotes-summary-grid">
        <article className="quotes-summary-card">
          <span>TOTAL</span>
          <strong>{resumen.total}</strong>
          <p>cotizaciones registradas</p>
        </article>

        <article className="quotes-summary-card">
          <span>BORRADORES</span>
          <strong>{resumen.borradores}</strong>
          <p>pendientes de emitir</p>
        </article>

        <article className="quotes-summary-card">
          <span>EMITIDAS</span>
          <strong>{resumen.emitidas}</strong>
          <p>en seguimiento</p>
        </article>

        <article className="quotes-summary-card">
          <span>ACEPTADAS</span>
          <strong>{resumen.aceptadas}</strong>
          <p>aceptadas o convertidas</p>
        </article>
      </div>


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


      {mostrarFormulario &&
        puedeGestionar && (
        <section className="quotes-form-card">
          <div className="quotes-form-head">
            <div>
              <span className="panel-label">
                {editando
                  ? 'EDITAR BORRADOR'
                  : 'NUEVA COTIZACIÓN'}
              </span>

              <h3>
                {editando
                  ? editando.numero
                  : 'Datos de la cotización'}
              </h3>

              <p>
                Agrega el cliente, la vigencia y los productos.
              </p>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => {
                setMostrarFormulario(false)
                limpiarFormulario()
              }}
            >
              ×
            </button>
          </div>

          <form
            onSubmit={
              guardarCotizacion
            }
          >
            <div className="quotes-form-grid">
              <label className="quotes-field">
                Cliente registrado
                <select
                  value={clienteId}
                  onChange={event => {
                    setClienteId(
                      event.target.value,
                    )

                    if (
                      event.target.value
                    ) {
                      setClienteNombre('')
                    }
                  }}
                >
                  <option value="">
                    Seleccionar / cliente no registrado
                  </option>

                  {clientes.map(
                    cliente => (
                      <option
                        key={cliente.id}
                        value={cliente.id}
                      >
                        {cliente.codigo} - {cliente.nombre}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="quotes-field">
                Nombre del cliente
                <input
                  type="text"
                  value={clienteNombre}
                  disabled={Boolean(
                    clienteId,
                  )}
                  onChange={event =>
                    setClienteNombre(
                      event.target.value,
                    )
                  }
                  placeholder="Solo si no está registrado"
                />
              </label>

              <label className="quotes-field">
                Vigencia hasta
                <input
                  type="date"
                  value={vigenciaHasta}
                  onChange={event =>
                    setVigenciaHasta(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label className="quotes-field quotes-field--full">
                Observaciones
                <textarea
                  value={observaciones}
                  onChange={event =>
                    setObservaciones(
                      event.target.value,
                    )
                  }
                  placeholder="Opcional"
                />
              </label>
            </div>


            <div className="quotes-items-head">
              <div>
                <span className="panel-label">
                  PRODUCTOS
                </span>
                <h3>
                  Detalle de cotización
                </h3>
              </div>

              <div className="quotes-add-product">
                <select
                  value={
                    productoSeleccionado
                  }
                  onChange={event =>
                    setProductoSeleccionado(
                      event.target.value,
                    )
                  }
                >
                  <option value="">
                    Seleccionar producto
                  </option>

                  {productos.map(
                    producto => (
                      <option
                        key={producto.id}
                        value={producto.id}
                      >
                        {producto.codigo} - {producto.nombre}
                      </option>
                    ),
                  )}
                </select>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    agregarProducto
                  }
                  disabled={
                    !productoSeleccionado
                  }
                >
                  + Agregar
                </button>
              </div>
            </div>


            <div className="quotes-items-table-wrap">
              <table className="quotes-items-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Precio</th>
                    <th>Subtotal</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="inventory-empty"
                      >
                        Agrega productos a la cotización.
                      </td>
                    </tr>
                  ) : (
                    items.map(item => (
                      <tr
                        key={
                          item.producto_id
                        }
                      >
                        <td>
                          <strong>
                            {item.nombre}
                          </strong>
                          <small>
                            {item.codigo}
                          </small>
                        </td>

                        <td>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={
                              item.cantidad
                            }
                            onChange={event =>
                              actualizarItem(
                                item.producto_id,
                                'cantidad',
                                Number(
                                  event.target.value,
                                ),
                              )
                            }
                          />
                        </td>

                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={
                              item.precio_unitario
                            }
                            onChange={event =>
                              actualizarItem(
                                item.producto_id,
                                'precio_unitario',
                                Number(
                                  event.target.value,
                                ),
                              )
                            }
                          />
                        </td>

                        <td>
                          <strong>
                            {formatearCordobas(
                              item.cantidad *
                              item.precio_unitario,
                            )}
                          </strong>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="sales-remove-button"
                            onClick={() =>
                              quitarItem(
                                item.producto_id,
                              )
                            }
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>


            <div className="quotes-form-footer">
              <div>
                <span>Total cotizado</span>
                <strong>
                  {formatearCordobas(
                    totalFormulario,
                  )}
                </strong>
              </div>

              <div className="clients-form-actions">
                <button
                  type="button"
                  className="product-secondary-button"
                  onClick={() => {
                    setMostrarFormulario(false)
                    limpiarFormulario()
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="product-primary-button"
                  disabled={
                    procesando
                  }
                >
                  {procesando
                    ? 'Guardando...'
                    : editando
                      ? 'Guardar cambios'
                      : 'Crear cotización'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}


      <section className="quotes-list-card">
        <div className="quotes-list-head">
          <div>
            <span className="panel-label">
              REGISTRO
            </span>
            <h3>
              Cotizaciones
            </h3>
          </div>

          <span className="sales-result-count">
            {cotizacionesFiltradas.length}{' '}
            resultado
            {cotizacionesFiltradas.length ===
            1
              ? ''
              : 's'}
          </span>
        </div>

        <div className="clients-search">
          <span>⌕</span>
          <input
            type="text"
            value={busqueda}
            onChange={event =>
              setBusqueda(
                event.target.value,
              )
            }
            placeholder="Buscar por número, cliente o estado..."
          />
        </div>

        <div className="quotes-table-wrap">
          <table className="quotes-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Vigencia</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {cotizacionesFiltradas.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="inventory-empty"
                  >
                    No se encontraron cotizaciones.
                  </td>
                </tr>
              ) : (
                cotizacionesFiltradas.map(
                  cotizacion => (
                    <tr
                      key={
                        cotizacion.id
                      }
                    >
                      <td>
                        <strong>
                          {cotizacion.numero}
                        </strong>
                      </td>

                      <td>
                        {cotizacion.cliente_nombre ??
                          'Cliente general'}
                      </td>

                      <td>
                        {formatearFecha(
                          cotizacion.vigencia_hasta,
                        )}
                      </td>

                      <td>
                        <strong>
                          {formatearCordobas(
                            cotizacion.total,
                          )}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={
                            claseEstado(
                              cotizacion.estado,
                            )
                          }
                        >
                          {etiquetaEstado(
                            cotizacion.estado,
                          )}
                        </span>
                      </td>

                      <td>
                        <div className="quotes-row-actions">
                          {puedeGestionar &&
                            cotizacion.estado ===
                              'borrador' && (
                            <>
                              <button
                                type="button"
                                className="product-edit-button"
                                onClick={() =>
                                  void editarCotizacion(
                                    cotizacion,
                                  )
                                }
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className="quotes-emit-button"
                                disabled={
                                  procesando
                                }
                                onClick={() =>
                                  void emitirCotizacion(
                                    cotizacion,
                                  )
                                }
                              >
                                Emitir
                              </button>
                            </>
                          )}

                          {!puedeGestionar && (
                            <span className="quotes-readonly">
                              Consulta
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}
