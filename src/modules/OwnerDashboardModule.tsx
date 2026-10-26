import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type Resumen = {
  ventas_hoy: number
  ventas_mes: number
  operaciones_mes: number
  ganancia_bruta_mes: number
  margen_bruto_pct: number
  cxc_pendiente: number
  cxc_vencida: number
  cuentas_vencidas: number
  compras_mes: number
  stock_bajo: number
  agotados: number
  pedidos_pendientes: number
}

type VentaDia = {
  fecha: string
  total: number
}

type TopProducto = {
  producto_id: number
  nombre: string
  cantidad: number
  monto: number
}

type UltimaCaja = {
  numero?: string
  estado?: string
  fecha_apertura?: string
  fecha_cierre?: string | null
  monto_inicial?: number
  diferencia?: number | null
}

type DashboardData = {
  generado_en: string
  resumen: Resumen
  ventas_7_dias: VentaDia[]
  top_productos: TopProducto[]
  ultima_caja: UltimaCaja
}

const resumenVacio: Resumen = {
  ventas_hoy: 0,
  ventas_mes: 0,
  operaciones_mes: 0,
  ganancia_bruta_mes: 0,
  margen_bruto_pct: 0,
  cxc_pendiente: 0,
  cxc_vencida: 0,
  cuentas_vencidas: 0,
  compras_mes: 0,
  stock_bajo: 0,
  agotados: 0,
  pedidos_pendientes: 0,
}

function numero(valor: unknown) {
  const n = Number(valor ?? 0)
  return Number.isFinite(n) ? n : 0
}

function dinero(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

function fechaCorta(valor: string) {
  const fecha = new Date(`${valor}T00:00:00`)

  return new Intl.DateTimeFormat('es-NI', {
    weekday: 'short',
    day: '2-digit',
  })
    .format(fecha)
    .replace('.', '')
}

function fechaHora(valor?: string | null) {
  if (!valor) return '—'

  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

export default function OwnerDashboardModule() {
  const [datos, setDatos] =
    useState<DashboardData | null>(null)

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] =
    useState('')

  async function cargarDashboard() {
    setCargando(true)
    setError('')

    const {
      data,
      error: rpcError,
    } = await supabase.rpc(
      'dashboard_propietario',
    )

    if (rpcError) {
      setError(rpcError.message)
      setCargando(false)
      return
    }

    const raw =
      (data ?? {}) as Record<string, any>

    const resumenRaw =
      (raw.resumen ?? {}) as Record<
        string,
        any
      >

    setDatos({
      generado_en:
        String(
          raw.generado_en ??
            new Date().toISOString(),
        ),

      resumen: {
        ventas_hoy:
          numero(
            resumenRaw.ventas_hoy,
          ),
        ventas_mes:
          numero(
            resumenRaw.ventas_mes,
          ),
        operaciones_mes:
          numero(
            resumenRaw.operaciones_mes,
          ),
        ganancia_bruta_mes:
          numero(
            resumenRaw.ganancia_bruta_mes,
          ),
        margen_bruto_pct:
          numero(
            resumenRaw.margen_bruto_pct,
          ),
        cxc_pendiente:
          numero(
            resumenRaw.cxc_pendiente,
          ),
        cxc_vencida:
          numero(
            resumenRaw.cxc_vencida,
          ),
        cuentas_vencidas:
          numero(
            resumenRaw.cuentas_vencidas,
          ),
        compras_mes:
          numero(
            resumenRaw.compras_mes,
          ),
        stock_bajo:
          numero(
            resumenRaw.stock_bajo,
          ),
        agotados:
          numero(
            resumenRaw.agotados,
          ),
        pedidos_pendientes:
          numero(
            resumenRaw.pedidos_pendientes,
          ),
      },

      ventas_7_dias:
        Array.isArray(
          raw.ventas_7_dias,
        )
          ? raw.ventas_7_dias.map(
              (
                item: Record<
                  string,
                  any
                >,
              ) => ({
                fecha:
                  String(
                    item.fecha ??
                      '',
                  ),
                total:
                  numero(
                    item.total,
                  ),
              }),
            )
          : [],

      top_productos:
        Array.isArray(
          raw.top_productos,
        )
          ? raw.top_productos.map(
              (
                item: Record<
                  string,
                  any
                >,
              ) => ({
                producto_id:
                  numero(
                    item.producto_id,
                  ),
                nombre:
                  String(
                    item.nombre ??
                      'Producto',
                  ),
                cantidad:
                  numero(
                    item.cantidad,
                  ),
                monto:
                  numero(
                    item.monto,
                  ),
              }),
            )
          : [],

      ultima_caja:
        (raw.ultima_caja ??
          {}) as UltimaCaja,
    })

    setCargando(false)
  }

  useEffect(() => {
    void cargarDashboard()
  }, [])

  const resumen =
    datos?.resumen ??
    resumenVacio

  const maxVentaDia =
    useMemo(
      () =>
        Math.max(
          1,
          ...(
            datos?.ventas_7_dias ??
            []
          ).map(
            item =>
              item.total,
          ),
        ),
      [datos],
    )

  const maxTopProducto =
    useMemo(
      () =>
        Math.max(
          1,
          ...(
            datos?.top_productos ??
            []
          ).map(
            item =>
              item.cantidad,
          ),
        ),
      [datos],
    )

  const alertas = useMemo(
    () => [
      {
        titulo:
          'Productos agotados',
        valor:
          resumen.agotados,
        detalle:
          resumen.agotados > 0
            ? 'Requieren revisión de reposición.'
            : 'No hay productos agotados.',
        nivel:
          resumen.agotados > 0
            ? 'critico'
            : 'ok',
      },
      {
        titulo:
          'Stock bajo',
        valor:
          resumen.stock_bajo,
        detalle:
          resumen.stock_bajo > 0
            ? 'Productos en o debajo del mínimo.'
            : 'Inventario sin alertas de mínimo.',
        nivel:
          resumen.stock_bajo > 0
            ? 'aviso'
            : 'ok',
      },
      {
        titulo:
          'Cuentas vencidas',
        valor:
          resumen.cuentas_vencidas,
        detalle:
          resumen.cuentas_vencidas > 0
            ? `${dinero(
                resumen.cxc_vencida,
              )} pendientes vencidos.`
            : 'No hay cuentas vencidas.',
        nivel:
          resumen.cuentas_vencidas > 0
            ? 'critico'
            : 'ok',
      },
      {
        titulo:
          'Pedidos pendientes',
        valor:
          resumen.pedidos_pendientes,
        detalle:
          resumen.pedidos_pendientes > 0
            ? 'Pedidos digitales aún no completados.'
            : 'No hay pedidos digitales pendientes.',
        nivel:
          resumen.pedidos_pendientes > 0
            ? 'aviso'
            : 'ok',
      },
    ],
    [resumen],
  )

  if (cargando) {
    return (
      <div className="owner-dashboard-loading">
        <div className="inventory-spinner" />
        <span>
          Preparando resumen del negocio...
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="owner-dashboard">
        <div className="inventory-error">
          {error}
        </div>

        <button
          type="button"
          className="product-primary-button"
          onClick={() =>
            void cargarDashboard()
          }
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="owner-dashboard">
      <section className="owner-dashboard-intro">
        <div>
          <span className="section-kicker">
            VISIÓN GENERAL DEL NEGOCIO
          </span>

          <h2>
            Estado de Casa Hogar
          </h2>

          <p>
            Indicadores ejecutivos para
            conocer ventas,
            rentabilidad, cartera,
            inventario y caja sin entrar
            en la operación diaria.
          </p>
        </div>

        <button
          type="button"
          className="owner-dashboard-refresh"
          onClick={() =>
            void cargarDashboard()
          }
        >
          Actualizar
        </button>
      </section>


      <section className="owner-kpi-grid owner-kpi-grid--main">
        <article className="owner-kpi">
          <span>
            VENTAS DE HOY
          </span>

          <strong>
            {dinero(
              resumen.ventas_hoy,
            )}
          </strong>

          <small>
            Monto vendido durante
            la jornada actual.
          </small>
        </article>

        <article className="owner-kpi">
          <span>
            VENTAS DEL MES
          </span>

          <strong>
            {dinero(
              resumen.ventas_mes,
            )}
          </strong>

          <small>
            {
              resumen.operaciones_mes
            }{' '}
            operaciones registradas.
          </small>
        </article>

        <article className="owner-kpi">
          <span>
            GANANCIA BRUTA EST.
          </span>

          <strong>
            {dinero(
              resumen.ganancia_bruta_mes,
            )}
          </strong>

          <small>
            Margen estimado:{' '}
            {
              resumen.margen_bruto_pct
            }
            %
          </small>
        </article>

        <article className="owner-kpi">
          <span>
            CUENTAS POR COBRAR
          </span>

          <strong>
            {dinero(
              resumen.cxc_pendiente,
            )}
          </strong>

          <small>
            {resumen.cuentas_vencidas}{' '}
            cuentas vencidas.
          </small>
        </article>
      </section>


      <section className="owner-kpi-grid owner-kpi-grid--secondary">
        <article className="owner-mini-kpi">
          <span>
            COMPRAS DEL MES
          </span>

          <strong>
            {dinero(
              resumen.compras_mes,
            )}
          </strong>
        </article>

        <article className="owner-mini-kpi">
          <span>
            STOCK BAJO
          </span>

          <strong>
            {resumen.stock_bajo}
          </strong>
        </article>

        <article className="owner-mini-kpi">
          <span>
            AGOTADOS
          </span>

          <strong>
            {resumen.agotados}
          </strong>
        </article>

        <article className="owner-mini-kpi">
          <span>
            PEDIDOS PENDIENTES
          </span>

          <strong>
            {
              resumen.pedidos_pendientes
            }
          </strong>
        </article>
      </section>


      <div className="owner-dashboard-two">
        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                VENTAS
              </span>

              <h3>
                Últimos 7 días
              </h3>
            </div>

            <strong>
              {dinero(
                (
                  datos?.ventas_7_dias ??
                  []
                ).reduce(
                  (
                    total,
                    item,
                  ) =>
                    total +
                    item.total,
                  0,
                ),
              )}
            </strong>
          </div>

          <div className="owner-bars">
            {(
              datos?.ventas_7_dias ??
              []
            ).map(item => {
              const porcentaje =
                item.total > 0
                  ? Math.max(
                      7,
                      (
                        item.total /
                        maxVentaDia
                      ) *
                        100,
                    )
                  : 2

              return (
                <div
                  className="owner-bar-item"
                  key={item.fecha}
                >
                  <div className="owner-bar-amount">
                    {item.total > 0
                      ? dinero(
                          item.total,
                        )
                      : 'C$0'}
                  </div>

                  <div className="owner-bar-track">
                    <div
                      className="owner-bar-fill"
                      style={{
                        height: `${porcentaje}%`,
                      }}
                    />
                  </div>

                  <span>
                    {fechaCorta(
                      item.fecha,
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </section>


        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                PRODUCTOS
              </span>

              <h3>
                Más vendidos del mes
              </h3>
            </div>
          </div>

          <div className="owner-top-products">
            {(
              datos?.top_productos ??
              []
            ).length === 0 ? (
              <div className="owner-empty">
                Aún no hay ventas del
                mes para calcular el
                ranking.
              </div>
            ) : (
              (
                datos?.top_productos ??
                []
              ).map(
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
                                (
                                  item.cantidad /
                                  maxTopProducto
                                ) *
                                  100,
                              )}%`,
                          }}
                        />
                      </div>

                      <small>
                        {dinero(
                          item.monto,
                        )}{' '}
                        vendidos
                      </small>
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </section>
      </div>


      <div className="owner-dashboard-two owner-dashboard-two--bottom">
        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                CAJA
              </span>

              <h3>
                Última jornada
              </h3>
            </div>

            {datos?.ultima_caja
              ?.estado && (
              <span
                className={
                  datos
                    .ultima_caja
                    .estado ===
                  'abierta'
                    ? 'owner-state owner-state--open'
                    : 'owner-state'
                }
              >
                {
                  datos
                    .ultima_caja
                    .estado
                }
              </span>
            )}
          </div>

          {datos?.ultima_caja
            ?.numero ? (
            <div className="owner-cash-summary">
              <div>
                <span>
                  JORNADA
                </span>
                <strong>
                  {
                    datos
                      .ultima_caja
                      .numero
                  }
                </strong>
              </div>

              <div>
                <span>
                  APERTURA
                </span>
                <strong>
                  {fechaHora(
                    datos
                      .ultima_caja
                      .fecha_apertura,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  CIERRE
                </span>
                <strong>
                  {fechaHora(
                    datos
                      .ultima_caja
                      .fecha_cierre,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  DIFERENCIA
                </span>
                <strong>
                  {datos
                    .ultima_caja
                    .diferencia ===
                    null ||
                  datos
                    .ultima_caja
                    .diferencia ===
                    undefined
                    ? 'Sin arqueo'
                    : dinero(
                        numero(
                          datos
                            .ultima_caja
                            .diferencia,
                        ),
                      )}
                </strong>
              </div>
            </div>
          ) : (
            <div className="owner-empty">
              Aún no existen jornadas
              de caja registradas.
            </div>
          )}
        </section>


        <section className="owner-dashboard-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                ATENCIÓN
              </span>

              <h3>
                Alertas del negocio
              </h3>
            </div>
          </div>

          <div className="owner-alert-list">
            {alertas.map(alerta => (
              <div
                className={`owner-alert owner-alert--${alerta.nivel}`}
                key={alerta.titulo}
              >
                <span className="owner-alert-dot" />

                <div>
                  <strong>
                    {alerta.titulo}
                  </strong>

                  <small>
                    {alerta.detalle}
                  </small>
                </div>

                <b>
                  {alerta.valor}
                </b>
              </div>
            ))}
          </div>
        </section>
      </div>


      <div className="owner-dashboard-update">
        Actualizado:{' '}
        {fechaHora(
          datos?.generado_en,
        )}
      </div>
    </div>
  )
}
