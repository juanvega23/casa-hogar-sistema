/* Íconos de línea de Mi cuenta */

const TRAZOS = {
  camion: 'M3 7h11v9H3z M14 10h4l3 3v3h-7z M7.500 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17.500 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  tienda: 'M4 10l1.500-5h13L20 10 M4 10a2.700 2.700 0 0 0 5.300 0 2.700 2.700 0 0 0 5.400 0 2.700 2.700 0 0 0 5.300 0 M5.500 13v7h13v-7 M10 20v-4h4v4',
  correo: 'M3.500 6h17v12h-17z M4 7l8 6 8-6',
  cedula: 'M3.500 6h17v12h-17z M9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 16c.500-1.500 1.600-2 3-2s2.500.500 3 2 M15 10h3 M15 13.500h3',
  telefono: 'M7 3.500h10v17H7z M11 17.500h2',
  candado: 'M6 11h12v9.500H6z M8.500 11V8a3.500 3.500 0 0 1 7 0v3',
  pin: 'M12 21s7-6.100 7-11.500a7 7 0 1 0-14 0C5 14.900 12 21 12 21z M12 12a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z',
  flecha: 'M6 9l6 6 6-6',
}

export function IconoCuenta({ nombre }: { nombre: keyof typeof TRAZOS }) {
  return (
    <svg className="t-micuenta-icono" viewBox="0 0 24 24" aria-hidden="true">
      <path d={TRAZOS[nombre]} />
    </svg>
  )
}
