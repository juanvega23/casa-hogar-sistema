import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type TipoAlerta =
  | 'inventario'
  | 'cartera'
  | 'ventas'
  | 'caja'
  | 'compras'

type Prioridad =
  | 'critica'
  | 'alta'
  | 'media'
  | 'baja'

type Filtro =
  | 'todas'
  | TipoAlerta

type Alerta = {
  tipo: TipoAlerta
  prioridad: Prioridad
  fecha: string
  estado: string
  destinatario_rol: string

  referencia_id: string
  referencia: string

  titulo: string
  mensaje: string
  recomendacion: string

  cantidad_sugerida: number
  proveedores_disponibles: number
  mejor_costo: number | null

  existencia_actual: number
  stock_minimo: number
  movimiento_30d: number
}

type AlertasData = {
  generado_en: string

  resumen: {
    total: number
    criticas: number
    altas: number
    medias: number
    bajas: number
    reposicion_sugerida_total: number
  }

  alertas: Alerta[]
}

function numero(
  valor: unknown,
) {
  const n = Number(
    valor ?? 0,
  )

  return Number.isFinite(n)
    ? n
    : 0
}

function dinero(
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

function tipoNombre(
  tipo: TipoAlerta,
) {
  const nombres: Record<
    TipoAlerta,
    string
  > = {
    inventario: 'Inventario',
    cartera: 'Cartera',
    ventas: 'Ventas',
    caja: 'Caja',
    compras: 'Compras',
  }

  return nombres[tipo]
}

function prioridadNombre(
  prioridad: Prioridad,
) {
  if (
    prioridad === 'critica'
  ) {
    return 'Crítica'
  }

  if (
    prioridad === 'alta'
  ) {
    return 'Alta'
  }

  if (
    prioridad === 'media'
  ) {
    return 'Media'
  }

  return 'Baja'
}

export default function OwnerAlertsModule() {
  const [datos, setDatos] =
    useState<AlertasData | null>(
      null,
    )

  const [filtro, setFiltro] =
    useState<Filtro>('todas')

  const [prioridad, setPrioridad] =
    useState<
      Prioridad | 'todas'
    >('todas')

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] =
    useState('')

  async function cargarAlertas() {
    setCargando(true)
    setError('')

    const {
      data,
      error: rpcError,
    } = await supabase.rpc(
      'alertas_recomendaciones_propietario',
    )

    if (rpcError) {
      setError(
        rpcError.message,
      )
      setCargando(false)
      return
    }

    const raw =
      (data ?? {}) as Record<
        string,
        any
      >

    const resumen =
      (raw.resumen ??
        {}) as Record<
        string,
        any
      >

    const alertasRaw =
      Array.isArray(
        raw.alertas,
      )
        ? raw.alertas
        : []

    setDatos({
      generado_en:
        String(
          raw.generado_en ??
            new Date().toISOString(),
        ),

      resumen: {
        total:
          numero(
            resumen.total,
          ),
        criticas:
          numero(
            resumen.criticas,
          ),
        altas:
          numero(
            resumen.altas,
          ),
        medias:
          numero(
            resumen.medias,
          ),
        bajas:
          numero(
            resumen.bajas,
          ),
        reposicion_sugerida_total:
          numero(
            resumen.reposicion_sugerida_total,
          ),
      },

      alertas:
        alertasRaw.map(
          (
            item: Record<
              string,
              any
            >,
          ) => ({
            tipo:
              item.tipo as TipoAlerta,

            prioridad:
              item.prioridad as Prioridad,

            fecha:
              String(
                item.fecha ??
                  '',
              ),

            estado:
              String(
                item.estado ??
                  'activa',
              ),

            destinatario_rol:
              String(
                item.destinatario_rol ??
                  'propietario',
              ),

            referencia_id:
              String(
                item.referencia_id ??
                  '',
              ),

            referencia:
              String(
                item.referencia ??
                  '',
              ),

            titulo:
              String(
                item.titulo ??
                  'Alerta',
              ),

            mensaje:
              String(
                item.mensaje ??
                  '',
              ),

            recomendacion:
              String(
                item.recomendacion ??
                  '',
              ),

            cantidad_sugerida:
              numero(
                item.cantidad_sugerida,
              ),

            proveedores_disponibles:
              numero(
                item.proveedores_disponibles,
              ),

            mejor_costo:
              item.mejor_costo ===
                null ||
              item.mejor_costo ===
                undefined
                ? null
                : numero(
                    item.mejor_costo,
                  ),

            existencia_actual:
              numero(
                item.existencia_actual,
              ),

            stock_minimo:
              numero(
                item.stock_minimo,
              ),

            movimiento_30d:
              numero(
                item.movimiento_30d,
              ),
          }),
        ),
    })

    setCargando(false)
  }

  useEffect(() => {
    void cargarAlertas()
  }, [])

  const alertasFiltradas =
    useMemo(() => {
      const alertas =
        datos?.alertas ?? []

      return alertas.filter(
        alerta => {
          const tipoOk =
            filtro === 'todas'
              ? true
              : alerta.tipo ===
                filtro

          const prioridadOk =
            prioridad ===
            'todas'
              ? true
              : alerta.prioridad ===
                prioridad

          return (
            tipoOk &&
            prioridadOk
          )
        },
      )
    }, [
      datos,
      filtro,
      prioridad,
    ])

  const reposiciones =
    useMemo(
      () =>
        (
          datos?.alertas ?? []
        ).filter(
          alerta =>
            alerta.tipo ===
              'inventario' &&
            alerta
              .cantidad_sugerida >
              0,
        ),
      [datos],
    )

  if (cargando) {
    return (
      <div className="owner-dashboard-loading">
        <div className="inventory-spinner" />

        <span>
          Analizando datos del
          negocio...
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="owner-alerts-module">
        <div className="inventory-error">
          {error}
        </div>

        <button
          type="button"
          className="product-primary-button"
          onClick={() =>
            void cargarAlertas()
          }
        >
          Reintentar
        </button>
      </div>
    )
  }

  const resumen =
    datos?.resumen ?? {
      total: 0,
      criticas: 0,
      altas: 0,
      medias: 0,
      bajas: 0,
      reposicion_sugerida_total: 0,
    }

  return (
    <div className="owner-alerts-module">
      <section className="owner-alerts-header">
        <div>
          <span className="section-kicker">
            ALERTAS / RECOMENDACIONES
          </span>

          <h2>
            Centro de decisiones
          </h2>

          <p>
            El sistema identifica
            situaciones que requieren
            atención y transforma los
            datos en recomendaciones
            para apoyar decisiones del
            propietario.
          </p>
        </div>

        <button
          type="button"
          className="owner-dashboard-refresh"
          onClick={() =>
            void cargarAlertas()
          }
        >
          Actualizar análisis
        </button>
      </section>


      <section className="owner-alert-summary">
        <article className="owner-alert-summary-card">
          <span>
            ALERTAS ACTIVAS
          </span>
          <strong>
            {resumen.total}
          </strong>
          <small>
            Situaciones detectadas
            automáticamente.
          </small>
        </article>

        <article className="owner-alert-summary-card owner-alert-summary-card--critical">
          <span>
            CRÍTICAS
          </span>
          <strong>
            {
              resumen.criticas
            }
          </strong>
          <small>
            Requieren atención
            prioritaria.
          </small>
        </article>

        <article className="owner-alert-summary-card owner-alert-summary-card--high">
          <span>
            PRIORIDAD ALTA
          </span>
          <strong>
            {resumen.altas}
          </strong>
          <small>
            Conviene revisarlas
            pronto.
          </small>
        </article>

        <article className="owner-alert-summary-card">
          <span>
            REPOSICIÓN SUGERIDA
          </span>
          <strong>
            {numero(
              resumen.reposicion_sugerida_total,
            )}
          </strong>
          <small>
            Unidades sugeridas según
            stock y movimiento.
          </small>
        </article>
      </section>


      {reposiciones.length > 0 && (
        <section className="owner-decision-card">
          <div className="owner-card-head">
            <div>
              <span className="section-kicker">
                REPOSICIÓN
              </span>

              <h3>
                Compras sugeridas
              </h3>
            </div>

            <span className="owner-decision-count">
              {
                reposiciones.length
              }{' '}
              productos
            </span>
          </div>

          <div className="owner-replenishment-grid">
            {reposiciones
              .slice(0, 6)
              .map(alerta => (
                <article
                  key={
                    alerta.referencia_id
                  }
                  className="owner-replenishment-item"
                >
                  <div className="owner-replenishment-head">
                    <div>
                      <span>
                        {
                          alerta.referencia
                        }
                      </span>

                      <strong>
                        {
                          alerta.mensaje.split(
                            ' tiene ',
                          )[0]
                        }
                      </strong>
                    </div>

                    <b>
                      +
                      {numero(
                        alerta.cantidad_sugerida,
                      )}
                    </b>
                  </div>

                  <div className="owner-replenishment-stats">
                    <div>
                      <span>
                        EXISTENCIA
                      </span>
                      <strong>
                        {numero(
                          alerta.existencia_actual,
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        MÍNIMO
                      </span>
                      <strong>
                        {numero(
                          alerta.stock_minimo,
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        VENDIDO 30 DÍAS
                      </span>
                      <strong>
                        {numero(
                          alerta.movimiento_30d,
                        )}
                      </strong>
                    </div>
                  </div>

                  <p>
                    {
                      alerta.recomendacion
                    }
                  </p>

                  <footer>
                    <span>
                      {
                        alerta.proveedores_disponibles
                      }{' '}
                      proveedores relacionados
                    </span>

                    {alerta.mejor_costo !==
                      null && (
                      <strong>
                        Mejor costo registrado:{' '}
                        {dinero(
                          alerta.mejor_costo,
                        )}
                      </strong>
                    )}
                  </footer>
                </article>
              ))}
          </div>
        </section>
      )}


      <section className="owner-decision-card">
        <div className="owner-alert-filter-row">
          <div>
            <span className="section-kicker">
              CENTRO DE DECISIONES
            </span>

            <h3>
              Situaciones que requieren
              atención
            </h3>
          </div>

          <div className="owner-alert-filters">
            <select
              value={filtro}
              onChange={e =>
                setFiltro(
                  e.target
                    .value as Filtro,
                )
              }
            >
              <option value="todas">
                Todas las áreas
              </option>
              <option value="inventario">
                Inventario
              </option>
              <option value="cartera">
                Cartera
              </option>
              <option value="ventas">
                Ventas
              </option>
              <option value="compras">
                Compras
              </option>
              <option value="caja">
                Caja
              </option>
            </select>

            <select
              value={prioridad}
              onChange={e =>
                setPrioridad(
                  e.target.value as
                    | Prioridad
                    | 'todas',
                )
              }
            >
              <option value="todas">
                Todas las prioridades
              </option>
              <option value="critica">
                Crítica
              </option>
              <option value="alta">
                Alta
              </option>
              <option value="media">
                Media
              </option>
              <option value="baja">
                Baja
              </option>
            </select>
          </div>
        </div>


        <div className="owner-decision-list">
          {alertasFiltradas.length ===
          0 ? (
            <div className="owner-empty">
              No hay alertas para los
              filtros seleccionados.
            </div>
          ) : (
            alertasFiltradas.map(
              (
                alerta,
                index,
              ) => (
                <article
                  key={`${alerta.tipo}-${alerta.referencia_id}-${index}`}
                  className={`owner-decision-alert owner-decision-alert--${alerta.prioridad}`}
                >
                  <div className="owner-decision-icon">
                    <span />
                  </div>

                  <div className="owner-decision-content">
                    <div className="owner-decision-title">
                      <div>
                        <strong>
                          {
                            alerta.titulo
                          }
                        </strong>

                        <span>
                          {tipoNombre(
                            alerta.tipo,
                          )}{' '}
                          ·{' '}
                          {
                            alerta.referencia
                          }
                        </span>
                      </div>

                      <b>
                        {prioridadNombre(
                          alerta.prioridad,
                        )}
                      </b>
                    </div>

                    <p>
                      {
                        alerta.mensaje
                      }
                    </p>

                    <div className="owner-decision-recommendation">
                      <span>
                        RECOMENDACIÓN
                      </span>

                      <strong>
                        {
                          alerta.recomendacion
                        }
                      </strong>
                    </div>
                  </div>
                </article>
              ),
            )
          )}
        </div>
      </section>


      <div className="owner-dashboard-update">
        Análisis actualizado:{' '}
        {fechaHora(
          datos?.generado_en,
        )}
      </div>
    </div>
  )
}
