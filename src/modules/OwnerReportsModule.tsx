import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type Area =
  | 'ventas'
  | 'compras'
  | 'inventario'
  | 'caja'

type ReporteData = {
  desde: string
  hasta: string
  generado_en: string

  ventas: {
    total: number
    operaciones: number
    ticket_promedio: number
    ganancia_bruta: number
    margen_bruto_pct: number
    contado: number
    credito: number
    cxc_pendiente: number
    cxc_vencida: number
    tendencia: {
      fecha: string
      total: number
      operaciones: number
    }[]
    top_productos: {
      producto_id: number
      nombre: string
      cantidad: number
      monto: number
    }[]
    ultimas_ventas: {
      numero: string
      fecha: string
      cliente: string | null
      tipo: string
      estado: string
      total: number
    }[]
  }

  compras: {
    total: number
    operaciones: number
    promedio: number
    registradas: number
    autorizadas: number
    recibidas: number
    ultimas_compras: {
      numero: string
      fecha: string
      estado: string
      tipo: string
      proveedor: string
      total: number
    }[]
  }

  inventario: {
    productos_activos: number
    stock_unidades: number
    valor_costo: number
    valor_venta: number
    stock_bajo: number
    agotados: number
    entradas_periodo: number
    salidas_periodo: number
    stock_critico: {
      producto_id: number
      codigo: string
      nombre: string
      existencia: number
      stock_minimo: number
      estado: string
    }[]
  }

  caja: {
    sesiones: number
    cerradas: number
    abiertas: number
    ingresos: number
    egresos: number
    saldo_movimientos: number
    diferencia_acumulada: number
    sesiones_con_diferencia: number
    jornadas: {
      numero: string
      apertura: string
      cierre: string | null
      estado: string
      monto_inicial: number
      diferencia: number | null
    }[]
  }
}

function hoyISO() {
  const ahora = new Date()
  const y = ahora.getFullYear()
  const m = String(
    ahora.getMonth() + 1,
  ).padStart(2, '0')
  const d = String(
    ahora.getDate(),
  ).padStart(2, '0')

  return `${y}-${m}-${d}`
}

function inicioMesISO() {
  const ahora = new Date()
  const y = ahora.getFullYear()
  const m = String(
    ahora.getMonth() + 1,
  ).padStart(2, '0')

  return `${y}-${m}-01`
}

function dinero(valor: number) {
  return new Intl.NumberFormat(
    'es-NI',
    {
      style: 'currency',
      currency: 'NIO',
      minimumFractionDigits: 2,
    },
  ).format(Number(valor ?? 0))
}

function numero(valor: number) {
  return new Intl.NumberFormat(
    'es-NI',
    {
      maximumFractionDigits: 2,
    },
  ).format(Number(valor ?? 0))
}

function fecha(valor?: string | null) {
  if (!valor) return '—'

  return new Intl.DateTimeFormat(
    'es-NI',
    {
      dateStyle: 'short',
    },
  ).format(
    new Date(
      valor.length === 10
        ? `${valor}T00:00:00`
        : valor,
    ),
  )
}

function fechaHora(
  valor?: string | null,
) {
  if (!valor) return '—'

  return new Intl.DateTimeFormat(
    'es-NI',
    {
      dateStyle: 'short',
      timeStyle: 'short',
    },
  ).format(new Date(valor))
}

function estadoLegible(
  valor: string,
) {
  return valor
    .replaceAll('_', ' ')
    .replace(
      /\b\w/g,
      letra =>
        letra.toUpperCase(),
    )
}

export default function OwnerReportsModule() {
  const [area, setArea] =
    useState<Area>('ventas')

  const [desde, setDesde] =
    useState(inicioMesISO())

  const [hasta, setHasta] =
    useState(hoyISO())

  const [datos, setDatos] =
    useState<ReporteData | null>(
      null,
    )

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] =
    useState('')

  async function cargarReporte() {
    setCargando(true)
    setError('')

    const {
      data,
      error: rpcError,
    } = await supabase.rpc(
      'reportes_propietario',
      {
        p_desde: desde,
        p_hasta: hasta,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
      setCargando(false)
      return
    }

    setDatos(
      data as ReporteData,
    )

    setCargando(false)
  }

  useEffect(() => {
    void cargarReporte()
  }, [])

  function aplicarPeriodo() {
    if (!desde || !hasta) {
      setError(
        'Selecciona las dos fechas.',
      )
      return
    }

    if (desde > hasta) {
      setError(
        'La fecha inicial no puede ser posterior a la fecha final.',
      )
      return
    }

    void cargarReporte()
  }

  function esteMes() {
    setDesde(inicioMesISO())
    setHasta(hoyISO())

    setTimeout(() => {
      void cargarReporte()
    }, 0)
  }

  const maxTendencia =
    useMemo(
      () =>
        Math.max(
          1,
          ...(
            datos?.ventas
              .tendencia ?? []
          ).map(
            item =>
              Number(
                item.total ?? 0,
              ),
          ),
        ),
      [datos],
    )

  const maxTop =
    useMemo(
      () =>
        Math.max(
          1,
          ...(
            datos?.ventas
              .top_productos ??
            []
          ).map(
            item =>
              Number(
                item.cantidad ?? 0,
              ),
          ),
        ),
      [datos],
    )

  return (
    <div className="owner-reports">
      <section className="owner-report-header">
        <div>
          <span className="section-kicker">
            REPORTES Y ANÁLISIS
          </span>

          <h2>
            Análisis del negocio
          </h2>

          <p>
            Consulta el comportamiento
            de ventas, compras,
            inventario y caja dentro
            del período seleccionado.
          </p>
        </div>

        <div className="owner-report-period">
          <label>
            Desde
            <input
              type="date"
              value={desde}
              onChange={e =>
                setDesde(
                  e.target.value,
                )
              }
            />
          </label>

          <label>
            Hasta
            <input
              type="date"
              value={hasta}
              onChange={e =>
                setHasta(
                  e.target.value,
                )
              }
            />
          </label>

          <button
            type="button"
            className="owner-report-secondary"
            onClick={esteMes}
          >
            Este mes
          </button>

          <button
            type="button"
            className="product-primary-button"
            onClick={aplicarPeriodo}
          >
            Aplicar
          </button>
        </div>
      </section>


      <nav className="owner-report-tabs">
        {(
          [
            [
              'ventas',
              'Ventas',
            ],
            [
              'compras',
              'Compras',
            ],
            [
              'inventario',
              'Inventario',
            ],
            [
              'caja',
              'Caja',
            ],
          ] as [
            Area,
            string,
          ][]
        ).map(
          ([codigo, nombre]) => (
            <button
              key={codigo}
              type="button"
              className={
                area === codigo
                  ? 'owner-report-tab owner-report-tab--active'
                  : 'owner-report-tab'
              }
              onClick={() =>
                setArea(codigo)
              }
            >
              {nombre}
            </button>
          ),
        )}
      </nav>


      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}


      {cargando ? (
        <div className="owner-dashboard-loading">
          <div className="inventory-spinner" />
          <span>
            Generando reporte...
          </span>
        </div>
      ) : !datos ? (
        <div className="owner-empty">
          No fue posible cargar el
          reporte.
        </div>
      ) : (
        <>
          {area === 'ventas' && (
            <VentasReport
              datos={datos}
              maxTendencia={
                maxTendencia
              }
              maxTop={maxTop}
            />
          )}

          {area === 'compras' && (
            <ComprasReport
              datos={datos}
            />
          )}

          {area ===
            'inventario' && (
            <InventarioReport
              datos={datos}
            />
          )}

          {area === 'caja' && (
            <CajaReport
              datos={datos}
            />
          )}
        </>
      )}


      {datos && !cargando && (
        <div className="owner-dashboard-update">
          Período:{' '}
          {fecha(datos.desde)} al{' '}
          {fecha(datos.hasta)} ·
          Generado:{' '}
          {fechaHora(
            datos.generado_en,
          )}
        </div>
      )}
    </div>
  )
}


function VentasReport({
  datos,
  maxTendencia,
  maxTop,
}: {
  datos: ReporteData
  maxTendencia: number
  maxTop: number
}) {
  const v = datos.ventas

  return (
    <>
      <section className="owner-report-kpis">
        <Kpi
          label="VENTAS DEL PERÍODO"
          value={dinero(v.total)}
          note={`${v.operaciones} operaciones`}
        />

        <Kpi
          label="TICKET PROMEDIO"
          value={dinero(
            v.ticket_promedio,
          )}
          note="Promedio por venta"
        />

        <Kpi
          label="GANANCIA BRUTA EST."
          value={dinero(
            v.ganancia_bruta,
          )}
          note={`Margen ${numero(
            v.margen_bruto_pct,
          )}%`}
        />

        <Kpi
          label="CUENTAS POR COBRAR"
          value={dinero(
            v.cxc_pendiente,
          )}
          note={`Vencido: ${dinero(
            v.cxc_vencida,
          )}`}
        />
      </section>


      <div className="owner-report-two">
        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                TENDENCIA
              </span>
              <h3>
                Ventas por día
              </h3>
            </div>
          </div>

          <div className="owner-report-bars">
            {v.tendencia.map(
              item => {
                const porcentaje =
                  item.total > 0
                    ? Math.max(
                        5,
                        (item.total /
                          maxTendencia) *
                          100,
                      )
                    : 1

                return (
                  <div
                    className="owner-report-bar-item"
                    key={
                      item.fecha
                    }
                  >
                    <span>
                      {dinero(
                        item.total,
                      )}
                    </span>

                    <div className="owner-report-bar-track">
                      <div
                        style={{
                          height:
                            `${porcentaje}%`,
                        }}
                      />
                    </div>

                    <small>
                      {fecha(
                        item.fecha,
                      )}
                    </small>
                  </div>
                )
              },
            )}
          </div>
        </section>


        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                COMPOSICIÓN
              </span>
              <h3>
                Contado y crédito
              </h3>
            </div>
          </div>

          <div className="owner-report-split">
            <div>
              <span>
                CONTADO
              </span>
              <strong>
                {dinero(
                  v.contado,
                )}
              </strong>
            </div>

            <div>
              <span>
                CRÉDITO
              </span>
              <strong>
                {dinero(
                  v.credito,
                )}
              </strong>
            </div>
          </div>

          <div className="owner-report-progress">
            <div
              style={{
                width:
                  v.total > 0
                    ? `${Math.min(
                        100,
                        (v.contado /
                          v.total) *
                          100,
                      )}%`
                    : '0%',
              }}
            />
          </div>

          <p className="owner-report-note">
            La barra representa la
            proporción de ventas de
            contado respecto al total.
          </p>
        </section>
      </div>


      <div className="owner-report-two">
        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                PRODUCTOS
              </span>
              <h3>
                Más vendidos
              </h3>
            </div>
          </div>

          <div className="owner-top-products">
            {v.top_productos
              .length === 0 ? (
              <div className="owner-empty">
                Sin ventas en este
                período.
              </div>
            ) : (
              v.top_productos.map(
                (
                  item,
                  index,
                ) => (
                  <div
                    className="owner-product-row"
                    key={
                      item.producto_id
                    }
                  >
                    <span className="owner-product-rank">
                      {index + 1}
                    </span>

                    <div className="owner-product-info">
                      <div className="owner-product-line">
                        <strong>
                          {
                            item.nombre
                          }
                        </strong>

                        <span>
                          {
                            item.cantidad
                          }{' '}
                          uds.
                        </span>
                      </div>

                      <div className="owner-product-track">
                        <div
                          style={{
                            width:
                              `${Math.max(
                                5,
                                (item.cantidad /
                                  maxTop) *
                                  100,
                              )}%`,
                          }}
                        />
                      </div>

                      <small>
                        {dinero(
                          item.monto,
                        )}
                      </small>
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </section>


        <section className="owner-dashboard-card">
          <ReportTable
            title="Últimas ventas"
            headers={[
              'Venta',
              'Fecha',
              'Cliente',
              'Tipo',
              'Total',
            ]}
            rows={v.ultimas_ventas.map(
              item => [
                item.numero,
                fecha(item.fecha),
                item.cliente ??
                  'Cliente general',
                estadoLegible(
                  item.tipo,
                ),
                dinero(
                  item.total,
                ),
              ],
            )}
          />
        </section>
      </div>
    </>
  )
}


function ComprasReport({
  datos,
}: {
  datos: ReporteData
}) {
  const c = datos.compras

  return (
    <>
      <section className="owner-report-kpis">
        <Kpi
          label="COMPRAS DEL PERÍODO"
          value={dinero(c.total)}
          note={`${c.operaciones} compras`}
        />

        <Kpi
          label="PROMEDIO POR COMPRA"
          value={dinero(
            c.promedio,
          )}
          note="Valor medio de compra"
        />

        <Kpi
          label="AUTORIZADAS"
          value={String(
            c.autorizadas,
          )}
          note="Pendientes de recepción"
        />

        <Kpi
          label="RECIBIDAS"
          value={String(
            c.recibidas,
          )}
          note={`${c.registradas} aún registradas`}
        />
      </section>

      <section className="owner-dashboard-card">
        <ReportTable
          title="Compras del período"
          headers={[
            'Compra',
            'Fecha',
            'Proveedor',
            'Tipo',
            'Estado',
            'Total',
          ]}
          rows={c.ultimas_compras.map(
            item => [
              item.numero,
              fecha(item.fecha),
              item.proveedor,
              estadoLegible(
                item.tipo,
              ),
              estadoLegible(
                item.estado,
              ),
              dinero(
                item.total,
              ),
            ],
          )}
        />
      </section>
    </>
  )
}


function InventarioReport({
  datos,
}: {
  datos: ReporteData
}) {
  const i = datos.inventario

  return (
    <>
      <section className="owner-report-kpis">
        <Kpi
          label="PRODUCTOS ACTIVOS"
          value={String(
            i.productos_activos,
          )}
          note={`${numero(
            i.stock_unidades,
          )} unidades en existencia`}
        />

        <Kpi
          label="VALOR A COSTO"
          value={dinero(
            i.valor_costo,
          )}
          note="Valor estimado del inventario"
        />

        <Kpi
          label="VALOR A VENTA"
          value={dinero(
            i.valor_venta,
          )}
          note="Valor potencial a precio actual"
        />

        <Kpi
          label="STOCK CRÍTICO"
          value={String(
            i.stock_bajo +
              i.agotados,
          )}
          note={`${i.agotados} agotados`}
        />
      </section>


      <div className="owner-report-two">
        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                MOVIMIENTO
              </span>
              <h3>
                Entradas y salidas
              </h3>
            </div>
          </div>

          <div className="owner-report-split">
            <div>
              <span>
                ENTRADAS
              </span>
              <strong>
                {numero(
                  i.entradas_periodo,
                )}
              </strong>
              <small>
                unidades
              </small>
            </div>

            <div>
              <span>
                SALIDAS
              </span>
              <strong>
                {numero(
                  i.salidas_periodo,
                )}
              </strong>
              <small>
                unidades
              </small>
            </div>
          </div>
        </section>


        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                CONTROL
              </span>
              <h3>
                Estado del inventario
              </h3>
            </div>
          </div>

          <div className="owner-report-split">
            <div>
              <span>
                STOCK BAJO
              </span>
              <strong>
                {i.stock_bajo}
              </strong>
            </div>

            <div>
              <span>
                AGOTADOS
              </span>
              <strong>
                {i.agotados}
              </strong>
            </div>
          </div>
        </section>
      </div>


      <section className="owner-dashboard-card">
        <ReportTable
          title="Productos que requieren atención"
          headers={[
            'Código',
            'Producto',
            'Existencia',
            'Mínimo',
            'Estado',
          ]}
          rows={i.stock_critico.map(
            item => [
              item.codigo,
              item.nombre,
              numero(
                item.existencia,
              ),
              numero(
                item.stock_minimo,
              ),
              item.estado ===
              'agotado'
                ? 'Agotado'
                : 'Stock bajo',
            ],
          )}
        />
      </section>
    </>
  )
}


function CajaReport({
  datos,
}: {
  datos: ReporteData
}) {
  const c = datos.caja

  return (
    <>
      <section className="owner-report-kpis">
        <Kpi
          label="INGRESOS DE CAJA"
          value={dinero(
            c.ingresos,
          )}
          note={`${c.sesiones} jornadas`}
        />

        <Kpi
          label="EGRESOS DE CAJA"
          value={dinero(
            c.egresos,
          )}
          note="Movimientos registrados"
        />

        <Kpi
          label="SALDO MOVIMIENTOS"
          value={dinero(
            c.saldo_movimientos,
          )}
          note={`${c.cerradas} jornadas cerradas`}
        />

        <Kpi
          label="DIFERENCIAS"
          value={dinero(
            c.diferencia_acumulada,
          )}
          note={`${c.sesiones_con_diferencia} jornadas con diferencia`}
        />
      </section>


      <section className="owner-dashboard-card">
        <ReportTable
          title="Jornadas de caja"
          headers={[
            'Jornada',
            'Apertura',
            'Cierre',
            'Estado',
            'Fondo inicial',
            'Diferencia',
          ]}
          rows={c.jornadas.map(
            item => [
              item.numero,
              fechaHora(
                item.apertura,
              ),
              fechaHora(
                item.cierre,
              ),
              estadoLegible(
                item.estado,
              ),
              dinero(
                item.monto_inicial,
              ),
              item.diferencia ===
                null
                ? 'Sin arqueo'
                : dinero(
                    item.diferencia,
                  ),
            ],
          )}
        />
      </section>
    </>
  )
}


function Kpi({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <article className="owner-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}


function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string
  headers: string[]
  rows: string[][]
}) {
  return (
    <>
      <div className="owner-card-head">
        <div>
          <span className="section-kicker">
            DETALLE
          </span>
          <h3>{title}</h3>
        </div>
      </div>

      <div className="owner-report-table-wrap">
        <table className="owner-report-table">
          <thead>
            <tr>
              {headers.map(
                header => (
                  <th key={header}>
                    {header}
                  </th>
                ),
              )}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    headers.length
                  }
                  className="inventory-empty"
                >
                  No hay registros
                  para el período
                  seleccionado.
                </td>
              </tr>
            ) : (
              rows.map(
                (
                  row,
                  rowIndex,
                ) => (
                  <tr key={rowIndex}>
                    {row.map(
                      (
                        value,
                        colIndex,
                      ) => (
                        <td
                          key={
                            colIndex
                          }
                        >
                          {value}
                        </td>
                      ),
                    )}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
