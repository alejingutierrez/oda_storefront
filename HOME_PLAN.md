# HOME_PLAN

## Objetivo
Definir el home editorial estilo Farfetch, con mega menu por genero, grillas cuadradas y modulos data-driven, usando las categorias reales actuales del catalogo.

## Criterios de exito
1. El mega menu cubre 100% de categorias actuales por genero.
2. La regla de clasificacion usa category + subcategory y es clara para implementacion.
3. El home se siente premium, minimalista y moderno, con imagenes cuadradas y buen ritmo editorial.
4. Performance alto (ISR, imagenes optimizadas, queries eficientes) y accesibilidad completa.

## Arquitectura de navegacion
Rutas base:
1. `/` home.
2. `/g/[gender]` landing por genero.
3. `/g/[gender]/[category]` listado por categoria.
4. `/g/[gender]/[category]/[subcategory]` listado por subcategoria cuando aplique.
5. `/buscar?q=...` busqueda global.

Reglas:
1. Si una categoria no tiene subcategorias, enlazar directo a `/g/[gender]/[category]`.
2. Si hay subcategorias visibles (outerwear, ropa_deportiva_y_performance), mostrar sus enlaces directos.

## Mega Menu - reglas de clasificacion
1. Normalizar genero:
   - Femenino: femenino, mujer
   - Masculino: masculino, hombre, male
   - Infantil: infantil, nino
   - Unisex: no_binario_unisex, unisex, unknown, vacio o null
2. Clasificar por categoria usando el mapa global abajo.
3. Casos especiales (category + subcategory):
   - outerwear: ir a Superiores, pero mostrar subcategorias (chaquetas, buzos, abrigos, blazers).
   - ropa_deportiva_y_performance:
     - Superiores: top_deportivo_bra_deportivo, camiseta_deportiva, chaqueta_deportiva, ropa_de_running, ropa_de_ciclismo, ropa_de_futbol_entrenamiento, ropa_de_compresion, conjunto_deportivo
     - Inferiores: leggings_deportivos, shorts_deportivos, sudadera_pants_deportivos
   - deportivo: Superiores por ahora (no tiene subcategoria en datos); si aparece subcategoria, aplicar heuristica simple: subcat con pantalon|short|legging|pants -> Inferiores; resto -> Superiores.

## 1) Mapa Global Completo (todas las categorias actuales)
Superiores:
camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres, chaquetas_y_abrigos, blazers_y_sastreria, conjuntos_y_sets_2_piezas, vestidos, enterizos_y_overoles, tops, uniformes_y_ropa_de_trabajo_escolar, outerwear, ropa_deportiva_y_performance, deportivo, knitwear, enterizos, ropa_de_bebe_0_24_meses

Inferiores:
pantalones_no_denim, jeans_y_denim, faldas, shorts_y_bermudas, bottoms

Accesorios:
accesorios_textiles_y_medias, bolsos_y_marroquineria, joyeria_y_bisuteria, calzado, gafas_y_optica, accesorios, tarjeta regalo, ropa_interior, ropa_interior_basica, lenceria_y_fajas_shapewear, pijamas_y_ropa_de_descanso_loungewear, trajes_de_bano_y_playa, trajes_de_bano

## 2) Estructura Final Por Genero (aplicada con datos reales)

Femenino
Superiores: camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres, chaquetas_y_abrigos, blazers_y_sastreria, conjuntos_y_sets_2_piezas, vestidos, enterizos_y_overoles, tops, uniformes_y_ropa_de_trabajo_escolar, outerwear, ropa_deportiva_y_performance, deportivo
Inferiores: pantalones_no_denim, jeans_y_denim, faldas, shorts_y_bermudas, bottoms
Accesorios: accesorios_textiles_y_medias, bolsos_y_marroquineria, joyeria_y_bisuteria, calzado, gafas_y_optica, accesorios, ropa_interior, ropa_interior_basica, lenceria_y_fajas_shapewear, pijamas_y_ropa_de_descanso_loungewear, trajes_de_bano_y_playa, trajes_de_bano

Masculino
Superiores: camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres, chaquetas_y_abrigos, blazers_y_sastreria, conjuntos_y_sets_2_piezas, tops, knitwear, uniformes_y_ropa_de_trabajo_escolar, outerwear, ropa_deportiva_y_performance, deportivo, enterizos_y_overoles, enterizos, vestidos
Inferiores: pantalones_no_denim, jeans_y_denim, shorts_y_bermudas, bottoms, faldas
Accesorios: accesorios_textiles_y_medias, calzado, bolsos_y_marroquineria, joyeria_y_bisuteria, gafas_y_optica, accesorios, ropa_interior, ropa_interior_basica, lenceria_y_fajas_shapewear, pijamas_y_ropa_de_descanso_loungewear, trajes_de_bano_y_playa, trajes_de_bano

Unisex
Superiores: camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres, chaquetas_y_abrigos, blazers_y_sastreria, conjuntos_y_sets_2_piezas, vestidos, enterizos_y_overoles, tops, knitwear, uniformes_y_ropa_de_trabajo_escolar, outerwear, ropa_deportiva_y_performance, deportivo, enterizos
Inferiores: pantalones_no_denim, jeans_y_denim, shorts_y_bermudas, faldas, bottoms
Accesorios: accesorios_textiles_y_medias, bolsos_y_marroquineria, joyeria_y_bisuteria, calzado, gafas_y_optica, accesorios, tarjeta regalo, ropa_interior, ropa_interior_basica, lenceria_y_fajas_shapewear, pijamas_y_ropa_de_descanso_loungewear, trajes_de_bano_y_playa, trajes_de_bano

Infantil
Superiores: camisetas_y_tops, camisas_y_blusas, buzos_hoodies_y_sueteres, chaquetas_y_abrigos, conjuntos_y_sets_2_piezas, vestidos, enterizos_y_overoles, tops, outerwear, ropa_de_bebe_0_24_meses, uniformes_y_ropa_de_trabajo_escolar, ropa_deportiva_y_performance, deportivo
Inferiores: pantalones_no_denim, jeans_y_denim, shorts_y_bermudas, faldas, bottoms
Accesorios: accesorios_textiles_y_medias, bolsos_y_marroquineria, joyeria_y_bisuteria, calzado, gafas_y_optica, accesorios, ropa_interior, ropa_interior_basica, lenceria_y_fajas_shapewear, pijamas_y_ropa_de_descanso_loungewear, trajes_de_bano_y_playa, trajes_de_bano

## Home - estructura y modulos
1. Header con mega menu y busqueda.
2. Hero editorial full-bleed con CTA doble.
3. Novedades (grid 4x2, tiles cuadrados).
4. Categorias clave (tiles 2x4 con top categorias reales).
5. Curated Edit por estilo (mosaico + carrusel por stylePrimary).
6. Shop by Color (grid de combinaciones y swatches).
7. Marcas destacadas (wall de logos).
8. Trending / Picks (heuristica mientras no existan events).
9. Story editorial (imagen + copy + CTA).
10. Footer rico (links, ayuda, redes, newsletter).

## Fuentes de datos y queries
1. Mega menu: `products` por genero normalizado, `category`, `subcategory`.
2. Novedades: `products` ordenado por `createdAt desc` con `imageCoverUrl`.
3. Categorias clave: top `category` global por conteo real.
4. Curated edit: top `stylePrimary` con productos asociados.
5. Shop by color: `color_combinations` + `color_combination_colors`.
6. Marcas destacadas: `brands` con `logoUrl`.
7. Trending: heuristica temporal mientras `events` esta vacio.

## Diseño y UX
1. Estetica editorial: fondo blanco calido, tipografia premium.
2. Imagenes cuadradas con hover sutil.
3. Espaciado generoso y grillas limpias.
4. Transiciones suaves en hover y despliegue del menu.

## Responsive
1. Desktop: mega menu 3 columnas.
2. Tablet: mega menu 2 columnas, subcategorias colapsables.
3. Mobile: drawer con acordeones por genero y columna.

## Performance
1. ISR en home y mega menu.
2. `next/image` con prioridad en hero.
3. Cache de queries server-side.
4. Evitar duplicar queries para modulos.

## Accesibilidad
1. Mega menu con teclado, `aria-expanded`, foco visible.
2. Cerrar con `Esc` y navegar con `Tab`.

## Entregables tecnicos
1. `apps/web/src/lib/navigation.ts` con:
   - `genderNormalizeMap`
   - `categoryGroups`
   - `categoryLabelMap`
   - `subcategoryLabelMap`
   - `categoryRules` para splits
2. `apps/web/src/components/MegaMenu.tsx`
3. `apps/web/src/components/Header.tsx`
4. `apps/web/src/app/page.tsx`
5. `apps/web/src/app/globals.css`

## Rotacion automatica de contenido (cada 3 dias)
Todos los productos y marcas que aparezcan en el home deben rotar cada 3 dias de forma dinamica y sin intervencion humana.

Reglas:
1. Usar una semilla deterministica basada en fecha con ventana de 3 dias (ej. `floor(epoch_days / 3)`) para rotar selections de home.
2. Aplicar la semilla en todas las secciones con productos o marcas (Novedades, Curated Edit, Marcas destacadas, Trending/Picks, Categorias clave si se muestran productos).
3. El resultado debe ser estable durante la ventana de 3 dias y cambiar automaticamente al iniciar la siguiente ventana.
4. No usar datos manuales ni hardcode para la rotacion.
5. Mantener filtros de negocio (stock, imagen valida, precio valido) pero reordenar por semilla.

Implementacion recomendada:
- Generar `rotationSeed = floor((now_utc_epoch_days) / 3)` en server.
- Usar `ORDER BY md5(id || rotationSeed)` o equivalente para obtener un orden pseudo-aleatorio estable.
- Cachear la respuesta de home con revalidacion menor o igual a 24h.
