# Estado Documental Procedimientos y Protocolos - ChinaLed

Dashboard QA/QC del PFV Cerro Sombrero (contrato 42PS25): avance documental de procedimientos y protocolos.

**Dashboard:** https://rarubilar.github.io/Estado-Documental-Procedimientos-y-Protocolos-ChinaLed/

## Cómo se actualiza

1. Las dos matrices Excel están en Google Drive, compartidas como "Cualquier persona con el enlace" (lector).
   Sus IDs están en `dashboard/config.json`.
2. **En vivo:** cada vez que alguien abre el link (o vuelve a la pestaña después de un minuto), la página descarga las
   dos matrices desde Google Drive y calcula el dashboard en el momento. "Estado documental al" muestra la fecha y hora
   del último cambio guardado en Drive, con la marca **● en vivo**. Usa una llave de solo lectura de la API de Drive
   (`driveApiKey` en `dashboard/config.json`), limitada a esa API y a este sitio.
3. **Respaldo:** la página también trae una copia guardada de los datos, que se ve mientras carga y si Google Drive no
   responde (aparece "copia guardada"). GitHub Actions (`.github/workflows/actualizar.yml`) la renueva cada hora cuando
   las matrices cambiaron.

Los Excel no se guardan en este repositorio: solo se publica la página procesada.
Para renovar la copia guardada al tiro: pestaña **Actions** → "Actualizar dashboard" → **Run workflow**.
