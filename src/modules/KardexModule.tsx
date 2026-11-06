import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import Paginador from './Paginador'
import { usePaginacion } from '../lib/paginacion'


// ==========================================================
// KÁRDEX POR PRODUCTO
//
// Tarjeta de un producto en orden cronológico: entradas,
// salidas y saldo, en unidades y en córdobas, valorizada con
// costo promedio ponderado. Solo consulta; los datos salen de
// kardex_producto() (ver su migración para el cálculo).
// ==========================================================

type ProductoOpcion = {
  id: number
  codigo: string
  nombre: string
  unidad_medida: string
}

type FilaKardex = {
  fecha: string
  documento: string | null
  detalle: string
  es_saldo_inicial: boolean
  entrada_cantidad: number | null
  entrada_costo: number | null
  entrada_total: number | null
  salida_cantidad: number | null
  salida_costo: number | null
  salida_total: number | null
  saldo_cantidad: number
  saldo_costo_promedio: number
  saldo_total: number
  costo_estimado: boolean
}

function dinero(valor: number | null) {
  if (valor === null) return ''

  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

// Importes de la tabla sin el símbolo (el encabezado dice C$)
function importe(valor: number | null) {
  if (valor === null) return ''

  return new Intl.NumberFormat('es-NI', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor)
}

function cantidad(valor: number | null) {
  if (valor === null) return ''

  return new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 }).format(valor)
}

function fecha(valor: string) {
  return new Intl.DateTimeFormat('es-NI', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Managua',
  }).format(new Date(valor))
}

// AAAA-MM-DD en hora de Managua
function hoyManagua() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date())
}

function numeros(fila: Record<string, unknown>): FilaKardex {
  const n = (valor: unknown) => (valor === null || valor === undefined ? null : Number(valor))

  return {
    fecha: String(fila.fecha),
    documento: fila.documento ? String(fila.documento) : null,
    detalle: String(fila.detalle ?? ''),
    es_saldo_inicial: Boolean(fila.es_saldo_inicial),
    entrada_cantidad: n(fila.entrada_cantidad),
    entrada_costo: n(fila.entrada_costo),
    entrada_total: n(fila.entrada_total),
    salida_cantidad: n(fila.salida_cantidad),
    salida_costo: n(fila.salida_costo),
    salida_total: n(fila.salida_total),
    saldo_cantidad: Number(fila.saldo_cantidad ?? 0),
    saldo_costo_promedio: Number(fila.saldo_costo_promedio ?? 0),
    saldo_total: Number(fila.saldo_total ?? 0),
    costo_estimado: Boolean(fila.costo_estimado),
  }
}

export default function KardexModule() {
  const [productos, setProductos] = useState<ProductoOpcion[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [productoId, setProductoId] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [filas, setFilas] = useState<FilaKardex[]>([])

  const paginacion = usePaginacion(filas)
  const [cargandoProductos, setCargandoProductos] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void supabase
      .from('productos')
      .select('id, codigo, nombre, unidad_medida')
      .order('nombre', { ascending: true })
      .then(({ data, error: productosError }) => {
        setCargandoProductos(false)

        if (productosError) {
          setError(`No fue posible cargar los productos: ${productosError.message}`)
          return
        }

        setProductos(
          (data ?? []).map(p => ({
            id: Number(p.id),
            codigo: String(p.codigo),
            nombre: String(p.nombre),
            unidad_medida: String(p.unidad_medida ?? 'unidad'),
          })),
        )
      })
  }, [])

  const opciones = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    if (!termino) return productos

    return productos.filter(p =>
      p.nombre.toLowerCase().includes(termino) ||
      p.codigo.toLowerCase().includes(termino),
    )
  }, [productos, busqueda])

  const producto = productos.find(p => String(p.id) === productoId) ?? null

  async function consultar(id: string, inicio: string, fin: string) {
    setProductoId(id)
    setError('')

    if (!id) {
      setFilas([])
      return
    }

    if (inicio && fin && inicio > fin) {
      setError('La fecha inicial no puede ser posterior a la final.')
      return
    }

    setCargando(true)

    const { data, error: rpcError } = await supabase.rpc('kardex_producto', {
      p_producto_id: Number(id),
      p_desde: inicio || null,
      p_hasta: fin || null,
    })

    setCargando(false)

    if (rpcError) {
      setError(rpcError.message)
      setFilas([])
      return
    }

    setFilas(((data ?? []) as Record<string, unknown>[]).map(numeros))
  }

  function cambiarRango(inicio: string, fin: string) {
    setDesde(inicio)
    setHasta(fin)
    void consultar(productoId, inicio, fin)
  }

  const movimientos = filas.filter(f => !f.es_saldo_inicial)
  const ultima = filas[filas.length - 1] ?? null
  const hayEstimados = filas.some(f => f.costo_estimado)

  const totales = movimientos.reduce(
    (t, f) => ({
      entradas: t.entradas + (f.entrada_cantidad ?? 0),
      entradasValor: t.entradasValor + (f.entrada_total ?? 0),
      salidas: t.salidas + (f.salida_cantidad ?? 0),
      salidasValor: t.salidasValor + (f.salida_total ?? 0),
    }),
    { entradas: 0, entradasValor: 0, salidas: 0, salidasValor: 0 },
  )

  const inicioMes = `${hoyManagua().slice(0, 8)}01`

  return (
    <div className="inventory-module">
      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">CONTROL DE INVENTARIO</span>
          <h2>Kárdex por producto</h2>
          <p>
            Tarjeta de cada producto con entradas, salidas y saldo, en unidades y en córdobas,
            valorizada con costo promedio ponderado.
          </p>
        </div>
      </div>

      <section className="kardex-filtros">
        <label className="kardex-producto">
          <span>Producto</span>
          <input
            type="search"
            value={busqueda}
            onChange={event => setBusqueda(event.target.value)}
            placeholder="Buscar por nombre o código..."
            disabled={cargandoProductos}
          />
          <select
            value={productoId}
            onChange={event => void consultar(event.target.value, desde, hasta)}
            disabled={cargandoProductos}
          >
            <option value="">
              {cargandoProductos
                ? 'Cargando productos...'
                : `Seleccionar producto (${opciones.length})`}
            </option>
            {opciones.map(p => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Desde</span>
          <input
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={event => cambiarRango(event.target.value, hasta)}
          />
        </label>

        <label>
          <span>Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={event => cambiarRango(desde, event.target.value)}
          />
        </label>

        <div className="kardex-rangos">
          <button
            type="button"
            className={desde === inicioMes && !hasta ? 'is-activo' : ''}
            onClick={() => cambiarRango(inicioMes, '')}
          >
            Este mes
          </button>
          <button
            type="button"
            className={!desde && !hasta ? 'is-activo' : ''}
            onClick={() => cambiarRango('', '')}
          >
            Todo
          </button>
        </div>
      </section>

      {error && <div className="inventory-error">{error}</div>}

      {!producto ? (
        <div className="kardex-vacio">
          Elige un producto para ver su tarjeta de kárdex.
        </div>
      ) : cargando ? (
        <div className="inventory-loading">
          <div className="inventory-spinner" />
          <span>Armando el kárdex...</span>
        </div>
      ) : (
        <>
          <div className="inventory-summary-grid">
            <article className="inventory-summary-card">
              <span>EXISTENCIA</span>
              <strong>{cantidad(ultima?.saldo_cantidad ?? 0)}</strong>
              <p>
                {hasta ? `al ${hasta.split('-').reverse().join('/')}` : 'actual'} · por {producto.unidad_medida}
              </p>
            </article>

            <article className="inventory-summary-card">
              <span>COSTO PROMEDIO</span>
              <strong>{dinero(ultima?.saldo_costo_promedio ?? 0)}</strong>
              <p>por {producto.unidad_medida}</p>
            </article>

            <article className="inventory-summary-card">
              <span>VALOR DEL INVENTARIO</span>
              <strong>{dinero(ultima?.saldo_total ?? 0)}</strong>
              <p>a costo promedio</p>
            </article>

            <article className="inventory-summary-card">
              <span>MOVIMIENTOS</span>
              <strong>{movimientos.length}</strong>
              <p>
                +{cantidad(totales.entradas)} / −{cantidad(totales.salidas)} en el período
              </p>
            </article>
          </div>

          <div className="kardex-tarjeta">
            <div className="kardex-cabecera">
              <div>
                <span>{producto.codigo}</span>
                <strong>{producto.nombre}</strong>
              </div>
              <small>Método: costo promedio ponderado · Unidad: {producto.unidad_medida}</small>
            </div>

            {filas.length === 0 ? (
              <div className="kardex-vacio">Este producto no tiene movimientos.</div>
            ) : (
              <div className="kardex-tabla-contenedor">
                <table className="kardex-tabla">
                  <thead>
                    <tr>
                      <th rowSpan={2}>Fecha</th>
                      <th rowSpan={2}>Documento</th>
                      <th rowSpan={2}>Detalle</th>
                      <th colSpan={3} className="kardex-grupo kardex-grupo--entrada">Entradas</th>
                      <th colSpan={3} className="kardex-grupo kardex-grupo--salida">Salidas</th>
                      <th colSpan={3} className="kardex-grupo kardex-grupo--saldo">Saldo</th>
                    </tr>
                    <tr>
                      <th>Cant.</th>
                      <th>C. unit. C$</th>
                      <th>Total C$</th>
                      <th>Cant.</th>
                      <th>C. unit. C$</th>
                      <th>Total C$</th>
                      <th>Cant.</th>
                      <th>C. prom. C$</th>
                      <th>Total C$</th>
                    </tr>
                  </thead>

                  <tbody>
                    {paginacion.visibles.map((fila, indice) => (
                      <tr key={`${fila.fecha}-${indice}`} className={fila.es_saldo_inicial ? 'is-inicial' : undefined}>
                        <td>{fila.es_saldo_inicial ? desde.split('-').reverse().join('/') : fecha(fila.fecha)}</td>
                        <td className="kardex-documento">{fila.documento ?? ''}</td>
                        <td>
                          {fila.detalle}
                          {fila.costo_estimado && <sup title="Costo estimado">*</sup>}
                        </td>
                        <td>{cantidad(fila.entrada_cantidad)}</td>
                        <td>{importe(fila.entrada_costo)}</td>
                        <td>{importe(fila.entrada_total)}</td>
                        <td>{cantidad(fila.salida_cantidad)}</td>
                        <td>{importe(fila.salida_costo)}</td>
                        <td>{importe(fila.salida_total)}</td>
                        <td className="kardex-saldo">{cantidad(fila.saldo_cantidad)}</td>
                        <td className="kardex-saldo">{importe(fila.saldo_costo_promedio)}</td>
                        <td className="kardex-saldo">{importe(fila.saldo_total)}</td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr>
                      <td>Totales del período</td>
                      <td />
                      <td />
                      <td>{cantidad(totales.entradas)}</td>
                      <td />
                      <td>{importe(totales.entradasValor)}</td>
                      <td>{cantidad(totales.salidas)}</td>
                      <td />
                      <td>{importe(totales.salidasValor)}</td>
                      <td>{cantidad(ultima?.saldo_cantidad ?? 0)}</td>
                      <td>{importe(ultima?.saldo_costo_promedio ?? 0)}</td>
                      <td>{importe(ultima?.saldo_total ?? 0)}</td>
                    </tr>
                  </tfoot>
                </table>
                <Paginador control={paginacion} />
              </div>
            )}

            {hayEstimados && (
              <p className="kardex-nota">
                * Costo estimado: el movimiento no trae costo (por ejemplo, el inventario inicial) y no
                había existencia valorizada, así que se usó el precio de compra actual del producto.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
