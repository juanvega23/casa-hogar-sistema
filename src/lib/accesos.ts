// Respuesta de intentar_acceso() (bloqueo por intentos fallidos),
// usada por el login interno y por el de la tienda.

type IntentoAcceso = {
  permitido?: boolean
  bloqueado?: boolean
  intentos_restantes?: number | null
  segundos_restantes?: number
}

/*
 * Devuelve el mensaje para la persona si no puede iniciar sesión, o
 * null si la contraseña es correcta y puede continuar. Si la función
 * no responde, no se deja pasar (falla cerrada).
 */
export function mensajeIntentoAcceso(
  datos: unknown,
  error: unknown,
  ayudaBloqueo: string,
): string | null {
  if (error || !datos || typeof datos !== 'object') {
    return 'No fue posible validar el acceso en este momento. Se puede intentar de nuevo en unos minutos.'
  }

  const intento = datos as IntentoAcceso

  if (intento.bloqueado) {
    const minutos = Math.max(1, Math.ceil((intento.segundos_restantes ?? 0) / 60))

    return `Por seguridad, la cuenta está bloqueada por varios intentos fallidos. Se podrá intentar de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}. ${ayudaBloqueo}`
  }

  if (!intento.permitido) {
    const restantes = intento.intentos_restantes ?? null

    if (restantes !== null && restantes > 0 && restantes <= 2) {
      return `Correo o contraseña incorrectos. ${restantes === 1 ? 'Queda 1 intento' : `Quedan ${restantes} intentos`} antes de que la cuenta se bloquee 15 minutos.`
    }

    return 'Correo o contraseña incorrectos.'
  }

  return null
}
