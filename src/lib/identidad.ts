// Cédula nicaragüense, teléfono y RUC: misma regla que la base
// (cedula_nicaraguense_valida(), normalizar_telefono_ni(), triggers de
// clientes_web, clientes y proveedores). La base es la que manda; esto
// solo avisa antes de enviar.
//
// Cédula 001-010190-0000M: municipio (3), nacimiento ddmmaa (6),
// consecutivo (4) y letra = posición (número de 13 dígitos módulo 23)
// en ABCDEFGHJKLMNPQRSTUVWXY.

const LETRAS_CEDULA = 'ABCDEFGHJKLMNPQRSTUVWXY'

function soloAlfanumerico(texto: string) {
  return texto.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

export function normalizarCedula(texto: string) {
  const x = soloAlfanumerico(texto)

  return /^[0-9]{13}[A-Z]$/.test(x)
    ? `${x.slice(0, 3)}-${x.slice(3, 9)}-${x.slice(9)}`
    : texto.trim().toUpperCase()
}

function fechaExiste(anio: number, mes: number, dia: number) {
  const fecha = new Date(anio, mes - 1, dia)
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia
}

// Mensaje del problema, o null si la cédula es válida.
export function errorCedula(texto: string): string | null {
  const x = soloAlfanumerico(texto)

  if (!x) return 'Ingresá tu número de cédula.'

  if (!/^[0-9]{13}[A-Z]$/.test(x)) {
    return 'La cédula tiene 13 números y una letra al final (ej. 001-010190-0000M).'
  }

  const dia = Number(x.slice(3, 5))
  const mes = Number(x.slice(5, 7))
  const aa = Number(x.slice(7, 9))

  if (!fechaExiste(1900 + aa, mes, dia) && !fechaExiste(2000 + aa, mes, dia)) {
    return 'Los 6 números del medio de la cédula no forman una fecha de nacimiento válida.'
  }

  const letra = LETRAS_CEDULA[Number(BigInt(x.slice(0, 13)) % 23n)]

  if (letra !== x[13]) {
    return 'La letra final no corresponde a los números de la cédula. Revisala.'
  }

  // Siglo 2000 salvo que quede en el futuro; 16 años o más
  const anioActual = new Date().getFullYear()
  const anio = 2000 + aa > anioActual ? 1900 + aa : 2000 + aa
  const limite = new Date()
  limite.setFullYear(limite.getFullYear() - 16)

  if (new Date(anio, mes - 1, dia) > limite) {
    return 'La fecha de nacimiento de la cédula no corresponde a una persona de 16 años o más.'
  }

  return null
}

// 8 dígitos sin espacios, guiones ni +505.
export function normalizarTelefono(texto: string) {
  const digitos = texto.replace(/[^0-9]/g, '')
  return digitos.length === 11 && digitos.startsWith('505') ? digitos.slice(3) : digitos
}

export function errorTelefono(texto: string): string | null {
  if (!texto.trim()) return 'Ingresá tu número de teléfono.'

  return /^[2578][0-9]{7}$/.test(normalizarTelefono(texto))
    ? null
    : 'El teléfono debe ser un número de Nicaragua de 8 dígitos (ej. 8123 4567).'
}

// RUC de empresa: J + 13 dígitos. Persona natural: su cédula.
export function errorRuc(texto: string, permitirCedula: boolean): string | null {
  const x = soloAlfanumerico(texto)

  if (!x) return null
  if (/^J[0-9]{13}$/.test(x)) return null
  if (permitirCedula && /^[0-9]{13}[A-Z]$/.test(x)) return errorCedula(x)

  return permitirCedula
    ? 'El RUC debe ser J seguida de 13 dígitos (empresa) o una cédula válida (persona natural).'
    : 'El RUC de una empresa debe ser la letra J seguida de 13 dígitos (ej. J0310000000000).'
}

/*
 * Traduce los errores de datos repetidos (índices únicos) a un
 * mensaje claro; si no es uno de esos, devuelve el mensaje original.
 */
export function mensajeIdentidad(mensaje: string) {
  if (/clientes_web_cedula_unique/.test(mensaje)) return 'Esa cédula ya está registrada en otra cuenta.'
  if (/clientes_web_telefono_unique/.test(mensaje)) return 'Ese teléfono ya está registrado en otra cuenta.'
  if (/clientes_identificacion_unique/.test(mensaje)) return 'Ya existe un cliente con esa cédula o RUC.'
  if (/proveedores_ruc_unique/.test(mensaje)) return 'Ya existe un proveedor con ese RUC.'

  return mensaje
}
