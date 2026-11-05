import {
  useEffect,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import { fechaCorta } from '../lib/soporteTi'

/*
 * Soporte TI → Panel: primera pantalla del rol, con lo pendiente de
 * Incidencias, Equipos y Respaldos. Gerencia lo consulta.
 */

type Resumen = {
  incidencias: {
    abiertas: number
    en_atencion: number
    por_confirmar: number
    alta_pendientes: number
    horas_promedio: number | null
    por_modulo: { modulo: string, total: number }[]
  }
  equipos: {
    total: number
    por_adquirir: number
    disponibles: number
    asignados: number
    en_reparacion: number
    garantia_por_vencer: number
  }
  respaldos: {
    ultima_copia: string | null
    dias_sin_copia: number | null
    ultima_prueba: string | null
    pruebas_realizadas: number
    pruebas_exitosas: number
  }
}

const DIAS_ALERTA = 7

export default function SupportPanelModule({
  soloConsulta,
  onAbrirModulo,
}: {
  soloConsulta: boolean
  onAbrirModulo: (id: string) => void
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const sufijo = soloConsulta ? '-consulta' : ''

  function cargar() {
    return supabase.rpc('resumen_panel_soporte').then(({ data, error: rpcError }) => {
      setCargando(false)

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      setError('')
      setResumen(data as Resumen)
    })
  }

  useEffect(() => {
    void cargar()
  }, [])

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando panel...</span>
      </div>
    )
  }

  if (!resumen) {
    return <div className="inventory-error">{error || 'No fue posible cargar el panel.'}</div>
  }

  const { incidencias, equipos, respaldos } = resumen

  const porcentaje = Number(respaldos.pruebas_realizadas) > 0
    ? Math.round((Number(respaldos.pruebas_exitosas) / Number(respaldos.pruebas_realizadas)) * 100)
    : null

  const avisos = [
    Number(incidencias.alta_pendientes) > 0 && `${incidencias.alta_pendientes} incidencia${Number(incidencias.alta_pendientes) === 1 ? '' : 's'} de prioridad alta sin resolver.`,
    respaldos.dias_sin_copia === null && 'Todavía no hay ninguna copia exitosa registrada.',
    respaldos.dias_sin_copia !== null && respaldos.dias_sin_copia >= DIAS_ALERTA && `Pasaron ${respaldos.dias_sin_copia} días sin una copia exitosa registrada.`,
    Number(equipos.garantia_por_vencer) > 0 && `${equipos.garantia_por_vencer} equipo${Number(equipos.garantia_por_vencer) === 1 ? '' : 's'} con garantía por vencer en 30 días.`,
  ].filter(Boolean) as string[]

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">SOPORTE TI</span>
          <h2>Panel de soporte</h2>
          <p>Lo que está pendiente en incidencias, equipos y respaldos.</p>
        </div>

        <button type="button" className="inventory-refresh-button" onClick={() => void cargar()}>
          ↻ Actualizar
        </button>
      </section>

      {error && <div className="inventory-error">{error}</div>}

      {avisos.map(aviso => <div key={aviso} className="soporte-aviso">{aviso}</div>)}

      <div className="soporte-panel">
        <section className="cash-card">
          <div className="soporte-panel-cabeza">
            <h3>Incidencias</h3>
            <button type="button" className="product-edit-button" onClick={() => onAbrirModulo(`incidencias${sufijo}`)}>Ver</button>
          </div>
          <dl className="soporte-datos soporte-datos--numeros">
            <div><dt>Abiertas</dt><dd>{incidencias.abiertas}</dd></div>
            <div><dt>En atención</dt><dd>{incidencias.en_atencion}</dd></div>
            <div><dt>Por confirmar</dt><dd>{incidencias.por_confirmar}</dd></div>
            <div><dt>Tiempo promedio</dt><dd>{incidencias.horas_promedio === null ? '—' : `${incidencias.horas_promedio} h`}</dd></div>
          </dl>
          <h4 className="soporte-subtitulo">Módulos con más reportes</h4>
          {incidencias.por_modulo.length === 0 && <p className="cash-help">Todavía no hay reportes.</p>}
          <ul className="soporte-ranking">
            {incidencias.por_modulo.map(fila => (
              <li key={fila.modulo}><span>{fila.modulo}</span><b>{fila.total}</b></li>
            ))}
          </ul>
        </section>

        <section className="cash-card">
          <div className="soporte-panel-cabeza">
            <h3>Equipos de TI</h3>
            <button type="button" className="product-edit-button" onClick={() => onAbrirModulo(`equipos-ti${sufijo}`)}>Ver</button>
          </div>
          <dl className="soporte-datos soporte-datos--numeros">
            <div><dt>Asignados</dt><dd>{equipos.asignados}</dd></div>
            <div><dt>Disponibles</dt><dd>{equipos.disponibles}</dd></div>
            <div><dt>En reparación</dt><dd>{equipos.en_reparacion}</dd></div>
            <div><dt>Por adquirir</dt><dd>{equipos.por_adquirir}</dd></div>
          </dl>
          <p className="cash-help">{equipos.total} equipos en total, sin contar los dados de baja.</p>
        </section>

        <section className="cash-card">
          <div className="soporte-panel-cabeza">
            <h3>Respaldos</h3>
            <button type="button" className="product-edit-button" onClick={() => onAbrirModulo(`respaldos${sufijo}`)}>Ver</button>
          </div>
          <dl className="soporte-datos soporte-datos--numeros">
            <div><dt>Última copia</dt><dd>{fechaCorta(respaldos.ultima_copia)}</dd></div>
            <div><dt>Última prueba</dt><dd>{fechaCorta(respaldos.ultima_prueba)}</dd></div>
            <div><dt>Pruebas realizadas</dt><dd>{respaldos.pruebas_realizadas}</dd></div>
            <div><dt>Satisfactorias</dt><dd>{porcentaje === null ? '—' : `${porcentaje} %`}</dd></div>
          </dl>
          <p className="cash-help">Es una bitácora: registra los resultados, pero no hace las copias.</p>
        </section>
      </div>
    </div>
  )
}
