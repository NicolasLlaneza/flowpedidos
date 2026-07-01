<?php
/**
 * Plugin Name: FlowPedidos - Permitir webhooks a n8n interno
 * Description: WordPress bloquea por seguridad las peticiones HTTP a IPs privadas
 *              (wp_http_validate_url). El container de n8n vive en la red Docker
 *              interna (IP 172.x), asi que la entrega del webhook de WooCommerce
 *              se rechaza con "URL no valida". Este filtro habilita explicitamente
 *              los hosts internos del stack para que el delivery funcione.
 *
 * Es un "must-use plugin": se carga solo, no requiere activacion. Solo afecta a
 * los hosts listados abajo; el resto sigue con la proteccion normal.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter(
	'http_request_host_is_external',
	function ( $is_external, $host ) {
		// Hosts internos del stack a los que SI permitimos peticiones.
		$allowed = array( 'tfi-n8n', 'n8n' );
		if ( in_array( $host, $allowed, true ) ) {
			return true;
		}
		return $is_external;
	},
	10,
	2
);
