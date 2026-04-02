function firstNonBlank(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function compactLine(...values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(' ');
}

function compactComma(...values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(', ');
}

function unwrapOrder(rawOrder) {
  if (rawOrder && typeof rawOrder === 'object' && rawOrder.order && typeof rawOrder.order === 'object') {
    return rawOrder.order;
  }
  return rawOrder;
}

function buildRecipientName(order) {
  return firstNonBlank(
    order?.shipping_address?.full_name,
    compactLine(order?.shipping_address?.name, order?.shipping_address?.surname),
    order?.shipping_address?.fullname,
    order?.customer?.full_name,
    compactLine(order?.customer?.name, order?.customer?.surname),
    order?.customer?.fullname,
    order?.billing_address?.full_name,
    compactLine(order?.billing_address?.name, order?.billing_address?.surname)
  );
}

function buildPhone(order) {
  return firstNonBlank(
    order?.shipping_address?.phone,
    order?.customer?.phone,
    order?.customer?.mobile,
    order?.billing_address?.phone
  );
}

function buildAddressFromNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  return firstNonBlank(
    compactComma(
      compactLine(
        node.address,
        node.address_1,
        node.address1,
        node.street,
        node.street_name
      ),
      compactLine(
        node.number,
        node.street_number
      ),
      compactLine(
        node.address_2,
        node.address2,
        node.complement,
        node.apartment,
        node.department
      )
    ),
    compactComma(node.address, node.address1, node.street)
  );
}

function buildDestinationAddress(order) {
  return firstNonBlank(
    buildAddressFromNode(order?.shipping_address),
    buildAddressFromNode(order?.shipping),
    buildAddressFromNode(order?.billing_address)
  );
}

function buildComuna(order) {
  return firstNonBlank(
    order?.shipping_address?.municipality,
    order?.shipping_address?.city,
    order?.shipping_address?.commune,
    order?.shipping_address?.county,
    order?.billing_address?.municipality,
    order?.billing_address?.city,
    order?.customer?.city
  );
}

function buildReference(order) {
  const parts = [
    firstNonBlank(order?.shipping_method?.name, order?.shipping_option?.name),
    order?.additional_information,
    order?.source,
    order?.source_name,
    order?.status ? `Jumpseller status ${order.status}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

function normalizePackageRef(order) {
  return firstNonBlank(
    order?.number != null ? String(order.number) : null,
    order?.order_number != null ? String(order.order_number) : null,
    order?.id != null ? String(order.id) : null
  );
}

export function unwrapJumpsellerOrder(rawOrder) {
  return unwrapOrder(rawOrder);
}

export function getJumpsellerStatusSnapshot(rawOrder) {
  const order = unwrapOrder(rawOrder);
  return {
    externalStatus: firstNonBlank(order?.status, order?.workflow_status),
    paymentStatus: firstNonBlank(order?.payment_status, order?.financial_status, order?.payment_state),
    fulfillmentStatus: firstNonBlank(order?.fulfillment_status, order?.shipping_status),
  };
}

export function mapJumpsellerOrderToSectoriceImportItem(rawOrder) {
  const order = unwrapOrder(rawOrder);
  const recipientName = buildRecipientName(order);
  const address = buildDestinationAddress(order);
  const comuna = buildComuna(order);

  if (!order?.id) {
    throw new Error('Jumpseller order.id es obligatorio para Sectorice');
  }
  if (!recipientName) {
    throw new Error('No se pudo resolver recipientName desde Jumpseller');
  }
  if (!address) {
    throw new Error('No se pudo resolver address desde Jumpseller');
  }
  if (!comuna) {
    throw new Error('No se pudo resolver comuna desde Jumpseller');
  }

  return {
    externalOrderId: String(order.id),
    externalShipmentId: null,
    externalPackageRef: normalizePackageRef(order),
    recipientName,
    phone: buildPhone(order),
    address,
    comuna,
    reference: buildReference(order),
    rawPayload: JSON.stringify(order),
    originName: null,
    originPhone: null,
    originAddress: null,
    originComuna: null,
  };
}

export function getJumpsellerCompleteness(rawOrder) {
  const order = unwrapOrder(rawOrder);
  const missing = [];
  if (!buildRecipientName(order)) missing.push('recipientName');
  if (!buildDestinationAddress(order)) missing.push('address');
  if (!buildComuna(order)) missing.push('comuna');
  return { complete: missing.length === 0, missing };
}
