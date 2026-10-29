import {
  useEffect,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'


// ==========================================================
// ALERTAS / RECOMENDACIONES (PROPIETARIO)
//
// Visión estratégica: resúmenes y tendencias del mes frente a
// los mismos días del mes anterior. El detalle operativo (cada
// producto, compra o cuenta) lo sigue Gerencia en su Panel de
// supervisión. Datos: alertas_recomendaciones_propietario().
// ==========================================================

type TipoAlerta =
  | 'ventas'
  | 'rentabilidad'
  | 'cartera'
  | 'inventario'
  | 'caja'

type Prioridad =
  | 'critica'
  | 'alta'
  | 'media'
  | 'baja'

type Alerta = {
  tipo: TipoAlerta
  prioridad: Prioridad
  titulo: string
  indicador: string
  mensaje: string
  recomendacion: string
}

type AlertasData = {
  generadoEn: string
  periodo: string
  alertas: Alerta[]
}

const TIPOS: Record<TipoAlerta, string> = {
  ventas: 'Ventas',
  rentabilidad: 'Rentabilidad',
  cartera: 'Cobros',
  inventario: 'Inventario',
  caja: 'Caja',
}

const PRIORIDADES: Record<Prioridad, string> = {
  critica: 'Urgente',
  alta: 'Requiere decisión',
  media: 'Para revisar',
  baja: 'Tendencia',
}

function fechaHora(valor: string) {
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

export default function OwnerAlertsModule() {
  const [datos, setDatos] = useState<AlertasData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  function pedirAlertas() {
    return supabase
      .rpc('alertas_recomendaciones_propietario')
      .then(({ data, error: rpcError }) => {
        setCargando(false)

        if (rpcError) {
          setError(rpcError.message)
          return
        }

        const raw = (data ?? {}) as {
          generado_en?: string
          periodo?: string
          alertas?: Alerta[]
        }

        setDatos({
          generadoEn: raw.generado_en ?? new Date().toISOString(),
          periodo: raw.periodo ?? 'Este mes',
          alertas: Array.isArray(raw.alertas) ? raw.alertas : [],
        })
      })
  }

  function cargarAlertas() {
    setCargando(true)
    setError('')
    void pedirAlertas()
  }

  useEffect(() => {
    void pedirAlertas()
  }, [])

  if (cargando && !datos) {
    return (
      <div className="owner-dashboard-loading">
        <div className="inventory-spinner" />
        <span>Analizando datos del negocio...</span>
      </div>
    )
  }

  const alertas = datos?.alertas ?? []

  const decisiones = alertas.filter(
    alerta => alerta.prioridad === 'critica' || alerta.prioridad === 'alta',
  ).length

  const revisar = alertas.filter(alerta => alerta.prioridad === 'media').length
  const tendencias = alertas.filter(alerta => alerta.prioridad === 'baja').length

  return (
    <div className="alertas-modulo">
      <section className="alertas-encabezado">
        <div>
          <span className="section-kicker">ALERTAS / RECOMENDACIONES</span>
          <h2>Cómo va el negocio</h2>
          <p>
            {datos?.periodo ?? 'Este mes'}, frente a los mismos días del mes pasado.
            Son resúmenes para decidir; el seguimiento de cada caso lo hace Gerencia.
          </p>
        </div>

        <button
          type="button"
          className="product-secondary-button"
          onClick={cargarAlertas}
          disabled={cargando}
        >
          {cargando ? 'Actualizando...' : 'Actualizar análisis'}
        </button>
      </section>

      {error && (
        <div className="inventory-error">{error}</div>
      )}

      {datos && (
        <>
          <section className="alertas-conteo">
            <article className={decisiones > 0 ? 'is-alta' : ''}>
              <strong>{decisiones}</strong>
              <span>Requieren decisión</span>
            </article>

            <article>
              <strong>{revisar}</strong>
              <span>Para revisar</span>
            </article>

            <article>
              <strong>{tendencias}</strong>
              <span>Tendencias</span>
            </article>
          </section>

          {alertas.length === 0 ? (
            <div className="alertas-vacio">
              <strong>Sin alertas</strong>
              <span>Todavía no hay movimientos suficientes este mes para analizar.</span>
            </div>
          ) : (
            <section className="alertas-tendencias">
              {alertas.map((alerta, indice) => (
                <article
                  key={`${alerta.tipo}-${indice}`}
                  className={`alerta-tarjeta alerta-item--${alerta.prioridad}`}
                >
                  <div className="alerta-tarjeta-cabeza">
                    <span>{TIPOS[alerta.tipo] ?? alerta.tipo}</span>

                    <span className={`alerta-prioridad alerta-prioridad--${alerta.prioridad}`}>
                      {PRIORIDADES[alerta.prioridad]}
                    </span>
                  </div>

                  <strong className="alerta-indicador">{alerta.indicador}</strong>
                  <h3>{alerta.titulo}</h3>
                  <p>{alerta.mensaje}</p>

                  <div className="alerta-recomendacion">
                    <b>Recomendación</b>
                    <span>{alerta.recomendacion}</span>
                  </div>
                </article>
              ))}
            </section>
          )}

          <div className="alertas-actualizado">
            Análisis actualizado: {fechaHora(datos.generadoEn)}
          </div>
        </>
      )}
    </div>
  )
}
