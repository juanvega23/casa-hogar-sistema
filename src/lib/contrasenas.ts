// Regla de contraseñas del sistema y de la tienda. Es la misma que
// tiene configurada Supabase Auth (que la impone en el servidor) y la
// Edge Function gestionar-usuarios: 8+ caracteres, mayúscula,
// minúscula, número y símbolo, sin espacios. Los símbolos son los que
// acepta Supabase.

const SIMBOLOS = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/

export const REGLAS_CLAVE = [
  { id: 'largo', texto: 'Al menos 8 caracteres', cumple: (clave: string) => clave.length >= 8 },
  { id: 'mayuscula', texto: 'Una letra mayúscula (A-Z)', cumple: (clave: string) => /[A-Z]/.test(clave) },
  { id: 'minuscula', texto: 'Una letra minúscula (a-z)', cumple: (clave: string) => /[a-z]/.test(clave) },
  { id: 'numero', texto: 'Un número', cumple: (clave: string) => /[0-9]/.test(clave) },
  { id: 'simbolo', texto: 'Un símbolo (!@#$%&*...)', cumple: (clave: string) => SIMBOLOS.test(clave) },
  { id: 'espacios', texto: 'Sin espacios', cumple: (clave: string) => clave.length > 0 && !/\s/.test(clave) },
]

// Mensaje con lo que falta, o null si la contraseña cumple todo.
export function errorClave(clave: string): string | null {
  const faltan = REGLAS_CLAVE.filter(regla => !regla.cumple(clave))

  if (!faltan.length) return null

  const lista = faltan.map(regla => regla.texto.charAt(0).toLowerCase() + regla.texto.slice(1))

  return `La contraseña debe tener: ${lista.join(', ')}.`
}
