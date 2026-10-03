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



type Compra = {

  id: number

  numero: string

  proveedor_id: number

  fecha_compra: string

  referencia_documento: string | null

  observaciones: string | null

  total: number | string

  tipo_compra:
    | 'directa'
    | 'cotizacion'
    | 'licitacion'

  estado: 'registrada' | 'anulada'

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



type PurchasesModuleProps = {

  roleCode: string

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
  tipo:
    | 'directa'
    | 'cotizacion'
    | 'licitacion',
) {
  if (tipo === 'cotizacion') {
    return 'Cotización'
  }

  if (tipo === 'licitacion') {
    return 'Licitación'
  }

  return 'Compra directa'
}





function PurchasesModule({

  roleCode,

}: PurchasesModuleProps) {

  const [proveedores, setProveedores] =

    useState<Proveedor[]>([])



  const [productos, setProductos] =

    useState<Producto[]>([])



  const [compras, setCompras] =

    useState<Compra[]>([])



  const [detalles, setDetalles] =

    useState<DetalleCompra[]>([])



  const [

    compraSeleccionada,

    setCompraSeleccionada,

  ] =

    useState<Compra | null>(null)



  const [

    mostrarFormulario,

    setMostrarFormulario,

  ] =

    useState(false)



  const [cargando, setCargando] =

    useState(true)



  const [guardando, setGuardando] =

    useState(false)



  const [

    cargandoDetalle,

    setCargandoDetalle,

  ] =

    useState(false)



  const [mensaje, setMensaje] =

    useState('')



  const [error, setError] =

    useState('')



  const [busqueda, setBusqueda] =

    useState('')



  const [

    proveedorId,

    setProveedorId,

  ] =

    useState('')



  const [
    tipoCompra,
    setTipoCompra,
  ] = useState<
    | 'directa'
    | 'cotizacion'
    | 'licitacion'
  >('directa')



  const [fechaCompra, setFechaCompra] =

    useState(fechaLocalActual())



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





  const puedeAnular =

    roleCode === 'administracion' ||

    roleCode === 'gerencia'





  // ==========================================================

  // CARGAR DATOS

  // ==========================================================



  async function cargarProveedores() {

    const { data, error } =

      await supabase

        .from('proveedores')

        .select(`

          id,

          codigo,

          nombre,

          activo

        `)

        .eq('activo', true)

        .order('nombre', {

          ascending: true,

        })



    if (error) {

      throw error

    }



    setProveedores(

      (data ?? []) as Proveedor[],

    )

  }





  async function cargarProductos() {

    const { data, error } =

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

        .eq('activo', true)

        .order('nombre', {

          ascending: true,

        })



    if (error) {

      throw error

    }



    setProductos(

      (data ?? []) as Producto[],

    )

  }





  async function cargarCompras() {

    const { data, error } =

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

          motivo_anulacion,

          anulada_at,

          created_at,

          proveedores (

            id,

            codigo,

            nombre

          )

        `)

        .order('created_at', {

          ascending: false,

        })

        .limit(100)



    if (error) {

      throw error

    }



    setCompras(

      (data ?? []) as unknown as Compra[],

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

      ])

    } catch (err) {

      setError(

        err instanceof Error

          ? err.message

          : 'No fue posible cargar el módulo de compras.',

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

        comprasRegistradas.reduce(

          (total, compra) =>

            total +

            Number(compra.total),

          0,

        ),

      [comprasRegistradas],

    )





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

        return compras

      }



      return compras.filter(

        compra => {

          const proveedor =

            obtenerProveedor(

              compra.proveedores,

            )



          const texto = [

            compra.numero,

                        compra.tipo_compra,

compra.estado,

            compra.fecha_compra,

            compra.referencia_documento ??

              '',

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

      compras,

      busqueda,

    ])





  // ==========================================================

  // NUEVA COMPRA

  // ==========================================================



  function abrirNuevaCompra() {

    setProveedorId('')

        setTipoCompra('directa')

setFechaCompra(

      fechaLocalActual(),

    )



    setReferenciaDocumento('')

    setObservaciones('')

    setProductoElegido('')

    setItems([])



    setCompraSeleccionada(null)

    setDetalles([])



    setError('')

    setMensaje('')



    setMostrarFormulario(true)

  }





  function cancelarCompra() {

    if (guardando) {

      return

    }



    setMostrarFormulario(false)

    setItems([])

    setProductoElegido('')

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

        producto.precio_compra ?? 0,

      )



    const nuevoItem: ItemCompra = {

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

        precioCompra.toFixed(2),

    }



    setItems(

      actuales => [

        ...actuales,

        nuevoItem,

      ],

    )



    setProductoElegido('')

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

                  [campo]: valor,

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

      Number(item.cantidad)



    const costo =

      Number(item.costo_unitario)



    if (

      !Number.isFinite(cantidad) ||

      !Number.isFinite(costo)

    ) {

      return 0

    }



    return cantidad * costo

  }





  const totalCompra =

    useMemo(

      () =>

        items.reduce(

          (total, item) =>

            total +

            obtenerSubtotal(item),

          0,

        ),

      [items],

    )





  // ==========================================================

  // REGISTRAR COMPRA

  // ==========================================================



  async function registrarCompra() {

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



      if (items.length === 0) {

        throw new Error(

          'Agregue al menos un producto.',

        )

      }





      for (const item of items) {

        const cantidad =

          Number(item.cantidad)



        const costo =

          Number(item.costo_unitario)



        if (

          !Number.isFinite(cantidad) ||

          cantidad <= 0

        ) {

          throw new Error(

            `La cantidad de ${item.nombre} debe ser mayor que cero.`,

          )

        }



        if (

          item.unidad_medida

            .trim()

            .toLowerCase() === 'unidad' &&

          !Number.isInteger(cantidad)

        ) {

          throw new Error(

            `La cantidad de ${item.nombre} debe ser un número entero porque su unidad de medida es unidad.`,

          )

        }



        if (

          !Number.isFinite(costo) ||

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





      const { data, error } =

        await supabase.rpc(

          'registrar_compra',

          {

            p_proveedor_id:

              Number(proveedorId),



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

        `Compra ${numero} registrada correctamente.`,

      )





      setMostrarFormulario(false)

      setProveedorId('')

            setTipoCompra('directa')

setReferenciaDocumento('')

      setObservaciones('')

      setProductoElegido('')

      setItems([])





      await cargarCompras()

    } catch (err) {

      setError(

        err instanceof Error

          ? err.message

          : 'No fue posible registrar la compra.',

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

      setCargandoDetalle(true)

      setError('')

      setMensaje('')



      setCompraSeleccionada(

        compra,

      )



      const { data, error } =

        await supabase

          .from('detalle_compras')

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

          .order('id', {

            ascending: true,

          })



      if (error) {

        throw error

      }



      setDetalles(

        (data ?? []) as unknown as DetalleCompra[],

      )

    } catch (err) {

      setError(

        err instanceof Error

          ? err.message

          : 'No fue posible cargar el detalle de la compra.',

      )

    } finally {

      setCargandoDetalle(false)

    }

  }





  function cerrarDetalle() {

    setCompraSeleccionada(null)

    setDetalles([])

  }





  // ==========================================================

  // ANULAR COMPRA

  // ==========================================================



  async function anularCompra(

    compra: Compra,

  ) {

    if (!puedeAnular) {

      return

    }



    const confirmado =

      window.confirm(

        `¿Deseas anular la compra ${compra.numero}? El inventario será revertido automáticamente.`,

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

      motivo.trim().length < 3

    ) {

      setError(

        'Debe indicar un motivo válido de al menos 3 caracteres.',

      )

      return

    }





    try {

      setError('')

      setMensaje('')



      const { error } =

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

        compraSeleccionada?.id ===

        compra.id

      ) {

        cerrarDetalle()

      }



      await cargarCompras()

    } catch (err) {

      setError(

        err instanceof Error

          ? err.message

          : 'No fue posible anular la compra.',

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

            Compras

          </h2>



          <p>

            Registro de compras,

            recepción de productos y

            actualización automática del

            inventario.

          </p>

        </div>





        <div

          style={{

            display: 'flex',

            gap: '10px',

            alignItems: 'center',

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





          <button

            type="button"

            className="primary-button"

            onClick={

              abrirNuevaCompra

            }

          >

            + Nueva compra

          </button>



        </div>

      </div>





      {/* ====================================================

          ESTADÍSTICAS

      ==================================================== */}



      <div className="inventory-stats">



        <div className="inventory-stat-card">

          <span>

            COMPRAS REGISTRADAS

          </span>



          <strong>

            {comprasRegistradas.length}

          </strong>



          <small>

            actualmente vigentes

          </small>

        </div>





        <div className="inventory-stat-card">

          <span>

            COMPRAS ANULADAS

          </span>



          <strong>

            {comprasAnuladas.length}

          </strong>



          <small>

            movimientos revertidos

          </small>

        </div>





        <div className="inventory-stat-card">

          <span>

            TOTAL VIGENTE

          </span>



          <strong

            style={{

              fontSize: '20px',

            }}

          >

            {moneda(totalVigente)}

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

            {proveedores.length}

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

          NUEVA COMPRA

      ==================================================== */}



      {mostrarFormulario && (



        <div className="inventory-toolbar">



          <div

            style={{

              width: '100%',

            }}

          >



            <div

              style={{

                display: 'flex',

                justifyContent:

                  'space-between',

                alignItems:

                  'flex-start',

                gap: '20px',

                marginBottom: '24px',

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

                  Selecciona el proveedor

                  y agrega los productos

                  recibidos.

                </p>

              </div>





              <button

                type="button"

                className="secondary-button"

                onClick={

                  cancelarCompra

                }

                disabled={guardando}

              >

                ✕ Cerrar

              </button>



            </div>





            {/* DATOS GENERALES */}



            <div

              style={{

                display: 'grid',

                gridTemplateColumns:

                  '2fr 1fr 1fr 1fr',

                gap: '16px',

                marginBottom: '18px',

              }}

            >



              <label>

                Proveedor *



                <select

                  value={proveedorId}

                  onChange={event =>

                    setProveedorId(

                      event.target.value,

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
                  value={tipoCompra}
                  onChange={event =>
                    setTipoCompra(
                      event.target.value as
                        | 'directa'
                        | 'cotizacion'
                        | 'licitacion',
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

                  value={fechaCompra}

                  onChange={event =>

                    setFechaCompra(

                      event.target.value,

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

                  onChange={event =>

                    setReferenciaDocumento(

                      event.target.value,

                    )

                  }

                  placeholder="Ej. FACT-0025"

                />

              </label>



            </div>





            <label>

              Observaciones



              <textarea

                value={observaciones}

                onChange={event =>

                  setObservaciones(

                    event.target.value,

                  )

                }

                placeholder="Información adicional de la compra..."

              />

            </label>





            {/* AGREGAR PRODUCTO */}



            <div

              style={{

                display: 'flex',

                alignItems: 'flex-end',

                gap: '10px',

                marginTop: '22px',

                marginBottom: '14px',

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

                  onChange={event =>

                    setProductoElegido(

                      event.target.value,

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

                    <th>CÓDIGO</th>

                    <th>PRODUCTO</th>

                    <th>UNIDAD</th>

                    <th>CANTIDAD</th>

                    <th>

                      COSTO UNITARIO

                    </th>

                    <th>SUBTOTAL</th>

                    <th />

                  </tr>

                </thead>





                <tbody>



                  {items.length === 0 && (

                    <tr>

                      <td

                        colSpan={7}

                        style={{

                          textAlign:

                            'center',

                          padding:

                            '30px',

                        }}

                      >

                        Agrega productos a

                        la compra.

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

                        {item.codigo}

                      </td>





                      <td>

                        <strong>

                          {item.nombre}

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

                              .toLowerCase() === 'unidad'

                              ? '1'

                              : '0.01'

                          }

                          step={

                            item.unidad_medida

                              .trim()

                              .toLowerCase() === 'unidad'

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

                                event.target

                                  .value,

                              )

                          }

                          style={{

                            width: '90px',

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

                                event.target

                                  .value,

                              )

                          }

                          style={{

                            width: '110px',

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



                  ))}



                </tbody>



              </table>



            </div>





            {/* TOTAL */}



            <div

              style={{

                display: 'flex',

                alignItems: 'center',

                justifyContent:

                  'space-between',

                gap: '20px',

                marginTop: '20px',

              }}

            >



              <div>

                <span

                  style={{

                    display: 'block',

                    fontSize: '10px',

                    color: '#7b8494',

                    marginBottom: '5px',

                  }}

                >

                  TOTAL DE COMPRA

                </span>



                <strong

                  style={{

                    fontSize: '25px',

                  }}

                >

                  {moneda(totalCompra)}

                </strong>

              </div>





              <div

                style={{

                  display: 'flex',

                  gap: '10px',

                }}

              >



                <button

                  type="button"

                  className="secondary-button"

                  onClick={

                    cancelarCompra

                  }

                  disabled={guardando}

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

              width: '100%',

            }}

          >



            <div

              style={{

                display: 'flex',

                justifyContent:

                  'space-between',

                gap: '20px',

                marginBottom: '20px',

              }}

            >



              <div>

                <span className="panel-label">

                  DETALLE DE COMPRA

                </span>



                <h2>

                  {

                    compraSeleccionada.numero

                  }

                </h2>



                <p>

                  {

                    obtenerProveedor(

                      compraSeleccionada.proveedores,

                    )?.nombre ??

                    'Proveedor'

                  }

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

                display: 'grid',

                gridTemplateColumns:

                  'repeat(5, minmax(0, 1fr))',

                gap: '14px',

                marginBottom: '20px',

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
                    compraSeleccionada.tipo_compra,
                  )}
                </strong>
              </div>




              <div>

                <span className="panel-label">

                  REFERENCIA

                </span>



                <strong>

                  {

                    compraSeleccionada

                      .referencia_documento ||

                    '—'

                  }

                </strong>

              </div>





              <div>

                <span className="panel-label">

                  ESTADO

                </span>



                <span

                  className={

                    compraSeleccionada

                      .estado ===

                    'registrada'

                      ? 'status-badge status-success'

                      : 'status-badge status-danger'

                  }

                >

                  {

                    compraSeleccionada

                      .estado ===

                    'registrada'

                      ? 'Registrada'

                      : 'Anulada'

                  }

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

              .observaciones && (

              <p

                style={{

                  marginBottom: '18px',

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

                  marginBottom: '18px',

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

                    <th>CÓDIGO</th>

                    <th>PRODUCTO</th>

                    <th>UNIDAD</th>

                    <th>CANTIDAD</th>

                    <th>

                      COSTO UNITARIO

                    </th>

                    <th>SUBTOTAL</th>

                  </tr>

                </thead>





                <tbody>



                  {cargandoDetalle && (

                    <tr>

                      <td

                        colSpan={6}

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

                              {

                                producto

                                  ?.codigo ??

                                '—'

                              }

                            </td>



                            <td>

                              <strong>

                                {

                                  producto

                                    ?.nombre ??

                                  'Producto'

                                }

                              </strong>

                            </td>



                            <td>

                              {

                                producto

                                  ?.unidad_medida ??

                                '—'

                              }

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

          display: 'flex',

          alignItems: 'center',

          justifyContent:

            'space-between',

          gap: '20px',

        }}

      >



        <input

          type="search"

          className="inventory-search"

          placeholder="⌕  Buscar compra, proveedor, factura..."

          value={busqueda}

          onChange={event =>

            setBusqueda(

              event.target.value,

            )

          }

        />



        <span

          style={{

            fontSize: '11px',

            color: '#7b8494',

          }}

        >

          {comprasFiltradas.length}

          {' '}

          {comprasFiltradas.length === 1

            ? 'compra'

            : 'compras'}

        </span>



      </div>





      <div className="inventory-table-wrapper">



        <table className="inventory-table">



          <thead>

            <tr>

              <th>NÚMERO</th>

              <th>FECHA</th>


              <th>TIPO</th>

              <th>PROVEEDOR</th>

              <th>FACTURA / REF.</th>

              <th>TOTAL</th>

              <th>ESTADO</th>

              <th>ACCIONES</th>

            </tr>

          </thead>





          <tbody>



            {comprasFiltradas.length ===

              0 && (

              <tr>

                <td

                  colSpan={8}

                  style={{

                    textAlign: 'center',

                    padding: '40px',

                  }}

                >

                  No hay compras para

                  mostrar.

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

                  <tr key={compra.id}>



                    <td>

                      <strong>

                        {compra.numero}

                      </strong>

                    </td>





                    <td>

                      {compra.fecha_compra}

                    </td>




                    <td>
                      {etiquetaTipoCompra(
                        compra.tipo_compra,
                      )}
                    </td>





                    <td>

                      <strong>

                        {

                          proveedor?.nombre ??

                          'Proveedor'

                        }

                      </strong>



                      {proveedor && (

                        <div

                          style={{

                            fontSize:

                              '10px',

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

                      {

                        compra.referencia_documento ||

                        '—'

                      }

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

                          compra.estado ===

                          'registrada'

                            ? 'status-badge status-success'

                            : 'status-badge status-danger'

                        }

                      >

                        {compra.estado ===

                        'registrada'

                          ? 'Registrada'

                          : 'Anulada'}

                      </span>

                    </td>





                    <td>

                      <div

                        style={{

                          display: 'flex',

                          gap: '8px',

                          alignItems:

                            'center',

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

                        >

                          Ver detalle

                        </button>





                        {puedeAnular &&

                          compra.estado ===

                            'registrada' && (



                          <button

                            type="button"

                            className="secondary-button"

                            onClick={() =>

                              void anularCompra(

                                compra,

                              )

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