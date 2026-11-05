import {
  useEffect,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  COLORES,
  conMayuscula,
  dinero,
  ESTADOS,
  leerConclusion,
  leerProyeccion,
  leerSenales,
  margen,
  mesAnterior,
  nombreMes,
  porcentaje,
  POCAS_VENTAS,
  type Panorama,
} from '../lib/negocioPropietario'
import { BarraPartida, GraficoLineas, VerDatos } from './OwnerCharts'

/*
 * Dashboard del Propietario: "¿Cómo va mi negocio?". Se lee de un
 * vistazo, sin nada que operar. Datos: panorama_propietario().
 * El detalle operativo es de Gerencia (Panel de supervisión).
 */

export default function OwnerDashboardModule() {
  const [datos, setDatos] = useState<Panorama | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vigente = true

    void supabase.rpc('panorama_propietario').then(({ data, error: rpcError }) => {
      if (!vigente) return

      setCargando(false)
      setError(rpcError ? rpcError.message : '')

      if (!rpcError) setDatos(data as Panorama)
    })

    return () => {
      vigente = false
    }
  }, [recarga])

  if (!datos) {
    return cargando ? (
      <div className="owner-dashboard-loading">
        <div className="inventory-spinner" />
        <span>Preparando el resumen de tu negocio...</span>
      </div>
    ) : (
      <div className="inventory-error">{error || 'No fue posible cargar el resumen.'}</div>
    )
  }

  const senales = leerSenales(datos)
  const conclusion = leerConclusion(datos, senales)
  const mes = nombreMes(datos.hoy)
  const anterior = mesAnterior(datos.hoy)
  const proyeccion = leerProyeccion(datos)
  const ganancia = margen(datos.ganancia.neto, datos.ganancia.costo)
  const gananciaAntes = margen(datos.ganancia.neto_anterior, datos.ganancia.costo_anterior)
  const queda = ganancia ?? 0
  const enMovimiento = Math.max(datos.inventario.valor - datos.inventario.sin_movimiento, 0)
  const paradoPct = porcentaje(datos.inventario.sin_movimiento, datos.inventario.valor)

  const dias = datos.acumulado.map(punto => punto.dia)
  const marcas = dias
    .map((dia, indice) => (dia === 1 || dia % 5 === 0 ? indice : -1))
    .filter(indice => indice >= 0)

  return (
    <div className="panorama">
      <section className="panorama-portada owner-dashboard-card">
        <div>
          <span className="section-kicker">
            {conMayuscula(mes).toUpperCase()} · DÍA {datos.dia} DE {datos.dias_mes}
          </span>
          <h2>{conclusion.titulo}</h2>
          <p>{conclusion.frases.join(' ')}</p>
        </div>

        <div className="panorama-heroe">
          <span>Ventas del mes</span>
          <strong>{dinero(datos.ventas.mes)}</strong>
          <small>{datos.ventas.operaciones === 1 ? '1 venta' : `${datos.ventas.operaciones} ventas`}</small>
        </div>
      </section>

      {error && <div className="inventory-error">{error}</div>}

      <section className="panorama-senales">
        {senales.map(senal => (
          <article key={senal.pregunta} className="panorama-senal owner-dashboard-card">
            <header>
              <span>{senal.pregunta}</span>
              <span className={`panorama-estado panorama-estado--${senal.estado}`}>
                <b aria-hidden="true">{ESTADOS[senal.estado].icono}</b>
                {ESTADOS[senal.estado].texto}
              </span>
            </header>
            <strong>{senal.respuesta}</strong>
            <p>{senal.detalle}</p>
          </article>
        ))}
      </section>

      <div className="panorama-dos">
        <section className="owner-dashboard-card panorama-tarjeta">
          <header className="panorama-pregunta">
            <h3>¿Cómo viene el mes?</h3>
            <p>
              {proyeccion === null
                ? 'Todavía es pronto para estimar el cierre del mes.'
                : `Si sigue este ritmo, ${mes} cerraría cerca de ${dinero(proyeccion)}${datos.ventas.operaciones < POCAS_VENTAS ? ' (estimación con pocas ventas, tómala solo como referencia)' : ''}.`}
            </p>
          </header>

          <GraficoLineas
            titulo={`Ventas acumuladas día a día de ${mes} frente a ${anterior}`}
            etiquetas={dias.map(dia => `Día ${dia}`)}
            marcas={marcas}
            series={[
              { nombre: conMayuscula(mes), color: COLORES.uno, valores: datos.acumulado.map(p => p.actual) },
              { nombre: conMayuscula(anterior), color: COLORES.apagado, valores: datos.acumulado.map(p => p.anterior) },
            ]}
          />

          <VerDatos
            columnas={['Día', conMayuscula(mes), conMayuscula(anterior)]}
            filas={datos.acumulado.map(p => [
              String(p.dia),
              p.actual === null ? '—' : dinero(p.actual),
              p.anterior === null ? '—' : dinero(p.anterior),
            ])}
          />
        </section>

        <div className="panorama-columna">
          <section className="owner-dashboard-card panorama-tarjeta">
            <header className="panorama-pregunta">
              <h3>De cada C$100 que vendes</h3>
              <p>
                {ganancia === null
                  ? 'Cuando haya ventas este mes verás cuánto te queda.'
                  : `C$${100 - queda} pagan la mercadería y C$${queda} te quedan.${gananciaAntes === null ? '' : ` En los mismos días de ${anterior} te quedaban C$${gananciaAntes}.`}`}
              </p>
            </header>

            {ganancia !== null && (
              <BarraPartida
                etiqueta="De cada C$100 vendidos"
                partes={[
                  { nombre: 'Lo que te queda', valor: datos.ganancia.neto - datos.ganancia.costo, color: COLORES.uno, tinta: '#ffffff' },
                  { nombre: 'Costo de la mercadería', valor: datos.ganancia.costo, color: COLORES.apagado, tinta: '#27264d' },
                ]}
              />
            )}

            <p className="panorama-nota">Antes de salarios, alquiler y otros gastos, que el sistema no registra.</p>
          </section>

          <section className="owner-dashboard-card panorama-tarjeta">
            <header className="panorama-pregunta">
              <h3>¿Dónde está tu dinero?</h3>
              <p>
                {datos.inventario.sin_movimiento > 0
                  ? `${paradoPct} % de tu mercadería, a precio de costo, no se ha vendido en 60 días.`
                  : 'Toda tu mercadería se ha vendido en los últimos 60 días.'}
              </p>
            </header>

            <BarraPartida
              etiqueta="Dinero en mercadería y por cobrar"
              partes={[
                { nombre: 'Mercadería que se vende', valor: enMovimiento, color: COLORES.uno, tinta: '#ffffff' },
                { nombre: 'Mercadería sin movimiento', valor: datos.inventario.sin_movimiento, color: COLORES.dos, tinta: '#27264d' },
                { nombre: 'Por cobrar a clientes', valor: datos.cobros.por_cobrar, color: COLORES.tres, tinta: '#27264d' },
              ]}
            />
          </section>
        </div>
      </div>

      <div className="panorama-pie">
        <span>Actualizado: {new Date(datos.generado_en).toLocaleString('es-NI', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <button
          type="button"
          className="inventory-refresh-button"
          disabled={cargando}
          onClick={() => {
            setCargando(true)
            setRecarga(valor => valor + 1)
          }}
        >
          ↻ Actualizar
        </button>
      </div>
    </div>
  )
}
