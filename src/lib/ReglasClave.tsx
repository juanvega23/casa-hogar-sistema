import { REGLAS_CLAVE } from './contrasenas'

// Requisitos de la contraseña que se marcan mientras se escribe.
export function ReglasClave({ clave }: { clave: string }) {
  return (
    <ul className="reglas-clave" aria-label="Requisitos de la contraseña">
      {REGLAS_CLAVE.map(regla => {
        const cumple = regla.cumple(clave)

        return (
          <li key={regla.id} className={cumple ? 'is-ok' : undefined}>
            <span aria-hidden="true">{cumple ? '✓' : '•'}</span>
            {regla.texto}
            <span className="sr-only">{cumple ? ' (cumplido)' : ' (pendiente)'}</span>
          </li>
        )
      })}
    </ul>
  )
}
