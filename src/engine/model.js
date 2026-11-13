// Справочники и матрица прав VIRIDEA

export const CATEGORIES = [
  { id: 'microclone', name: 'Микроклоны', short: 'Микроклоны', live: true },
  { id: 'adapted', name: 'Адаптированные растения', short: 'Адаптированные', live: true },
  { id: 'seedling', name: 'Саженцы', short: 'Саженцы', live: true },
  { id: 'care', name: 'Товары для ухода', short: 'Уход', live: false },
];
export const catName = (id) => CATEGORIES.find((c) => c.id === id)?.name || id;

export const CHANNELS = [
  { id: 'site', name: 'Сайт' },
  { id: 'vk', name: 'VK' },
  { id: 'telegram', name: 'Telegram' },
  { id: 'offline', name: 'Офлайн (в перспективе)' },
];

export const CARRIERS = [
  { id: 'cdek', name: 'СДЭК', price: 450, live: true, recommended: true, days: '2–4 дня' },
  { id: 'yandex', name: 'Яндекс Доставка', price: 390, live: true, days: '1–3 дня' },
  { id: '5post', name: '5Post', price: 290, live: false, days: '3–6 дней' },
  { id: 'ozon', name: 'Ozon Доставка', price: 260, live: false, days: '3–7 дней' },
  { id: 'russianpost', name: 'Почта России', price: 350, live: false, days: '5–12 дней' },
];
// live=false: перевозчик не рекомендован для живых растений 

export const ROLES = [
  { id: 'owner', name: 'Владелец' },
  { id: 'head', name: 'Руководитель' },
  { id: 'manager', name: 'Менеджер' },
  { id: 'warehouse', name: 'Склад' },
];
export const roleName = (id) => ROLES.find((r) => r.id === id)?.name || id;

export const PERMISSIONS = {
  'catalog.view': ['owner', 'head', 'manager', 'warehouse'],
  'catalog.edit': ['owner', 'head', 'manager'],
  'pricelist.import': ['owner', 'head', 'manager'],
  'supply.view': ['owner', 'head', 'manager', 'warehouse'],
  'supply.edit': ['owner', 'head', 'manager'],
  'supply.confirm': ['owner', 'head', 'manager'],
  'supply.receive': ['owner', 'head', 'warehouse'],
  'allocation.manual': ['owner', 'head'],
  'stock.view': ['owner', 'head', 'manager', 'warehouse'],
  'stock.move': ['owner', 'head', 'warehouse'],
  'stock.quarantine': ['owner', 'head', 'warehouse'],
  'stock.writeoff': ['owner', 'head'],
  'stock.inventory': ['owner', 'head', 'warehouse'],
  'stock.inventory.approve': ['owner', 'head'],
  'reservation.extend': ['owner', 'head', 'manager'],
  'adaptation.manage': ['owner', 'head', 'warehouse'],
  'order.view': ['owner', 'head', 'manager', 'warehouse'],
  'order.edit': ['owner', 'head', 'manager'],
  'payment.record': ['owner', 'head', 'manager'],
  'payment.refund': ['owner', 'head'],
  'shipment.manage': ['owner', 'head', 'manager', 'warehouse'],
  'ship.exception': ['owner', 'head'],
  'compensation.grant': ['owner', 'head'],
  'claim.decide': ['owner', 'head', 'manager'],
  'finance.view': ['owner', 'head', 'manager'],
  'finance.edit': ['owner', 'head'],
  'sync.view': ['owner', 'head'],
  'audit.view': ['owner', 'head'],
  'users.manage': ['owner'],
  'api.manage': ['owner', 'head'],
};

export const PERMISSION_LABELS = {
  'catalog.view': 'Каталог: просмотр',
  'catalog.edit': 'Каталог: редактирование',
  'pricelist.import': 'Импорт прайсов',
  'supply.view': 'Поставки: просмотр',
  'supply.edit': 'Поставки: создание',
  'supply.confirm': 'Поставки: подтверждения лаборатории',
  'supply.receive': 'Поставки: физическая приёмка',
  'allocation.manual': 'Ручное распределение дефицита',
  'stock.view': 'Склад: просмотр',
  'stock.move': 'Склад: перемещения',
  'stock.quarantine': 'Склад: карантин',
  'stock.writeoff': 'Склад: списание',
  'stock.inventory': 'Инвентаризация: ввод',
  'stock.inventory.approve': 'Инвентаризация: утверждение корректировки',
  'reservation.extend': 'Продление резерва',
  'adaptation.manage': 'Адаптация',
  'order.view': 'Заказы: просмотр',
  'order.edit': 'Заказы: изменение',
  'payment.record': 'Платежи: внесение',
  'payment.refund': 'Возвраты',
  'shipment.manage': 'Посылки',
  'ship.exception': 'Отгрузка без полной оплаты',
  'compensation.grant': 'Компенсации',
  'claim.decide': 'Претензии: решение',
  'finance.view': 'Финансы: просмотр',
  'finance.edit': 'Финансы: внесение расходов',
  'sync.view': 'Синхронизация Google Диска',
  'audit.view': 'Журнал аудита',
  'users.manage': 'Сотрудники и права',
  'api.manage': 'API-ключи',
};

export const EXPENSE_CATEGORIES = [
  { id: 'logistics_in', name: 'Входящая логистика', type: 'direct' },
  { id: 'packaging', name: 'Упаковка', type: 'variable' },
  { id: 'commission', name: 'Комиссия платёжной системы', type: 'variable' },
  { id: 'delivery_subsidy', name: 'Субсидия доставки', type: 'variable' },
  { id: 'materials', name: 'Материалы адаптации', type: 'direct' },
  { id: 'rent', name: 'Аренда', type: 'overhead' },
  { id: 'salary', name: 'Зарплата', type: 'overhead' },
  { id: 'marketing', name: 'Реклама', type: 'overhead' },
  { id: 'services', name: 'Сервисы и хостинг', type: 'overhead' },
  { id: 'withdrawal', name: 'Личное изъятие владельца', type: 'withdrawal' },
];
export const expCat = (id) => EXPENSE_CATEGORIES.find((c) => c.id === id) || { id, name: id, type: 'overhead' };

export const MOVEMENT_TYPES = {
  receipt: 'Приход (приёмка)',
  reserve: 'Резерв',
  release: 'Снятие резерва',
  transfer_out: 'Перемещение (расход)',
  transfer_in: 'Перемещение (приход)',
  writeoff: 'Списание',
  quarantine: 'В карантин',
  quarantine_release: 'Из карантина',
  sale: 'Отгрузка покупателю',
  return: 'Возврат',
  to_adaptation: 'Передача в адаптацию',
  from_adaptation: 'Выход из адаптации',
  individual_split: 'Выделение индивидуальных карточек',
  individual_in: 'Индивидуальная карточка',
  inventory_adjust: 'Корректировка инвентаризации',
};

export const LINE_STATUS = {
  reserved: 'Зарезервировано',
  queued: 'В очереди предзаказа',
  confirmed: 'Подтверждено лабораторией',
  partial: 'Подтверждено частично',
  shortage: 'Дефицит — нужно решение',
  expired: 'Резерв истёк',
  shipped: 'Отправлено',
  replaced: 'Заменено',
  cancelled: 'Отменено',
};

export const ORDER_STATUS = {
  new: 'Новый',
  awaiting_payment: 'Ожидает оплаты',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  awaiting_supply: 'Ожидает поступления',
  needs_decision: 'Нужно решение',
  partially_shipped: 'Частично отправлен',
  shipped: 'Отправлен',
  delivered: 'Получен',
  cancelled: 'Отменён',
};

export const SHIPMENT_STATUS = {
  created: 'Собирается',
  handed_over: 'Передана перевозчику',
  arrived: 'Прибыла в пункт выдачи',
  received: 'Получена',
};

export const RESERVE_HOURS = 72;
export const EXTEND_HOURS = 48;
