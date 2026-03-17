// mews-kiosk-server.js
// Petit serveur Node.js pour tester l'intégration Kiosk POS avec Mews Connector API.

const express = require('express');
const cors = require('cors');
const nodeFetch = require('node-fetch');
const fetch = nodeFetch.default || nodeFetch;  // ✅ Force l'export correct

// =========================
// Configuration MEWS
// =========================

const MEWS_CONFIG = {
  platformAddress: process.env.MEWS_PLATFORM_ADDRESS || 'https://api.mews-demo.com',
  clientToken:
    process.env.MEWS_CLIENT_TOKEN ||
    '9381AB282F844CD9A2F4AD200158E7BC-D27113FA792B0855F87D0F93E9E1D71',
  accessToken:
    process.env.MEWS_ACCESS_TOKEN ||
    'B811B453B8144A73B80CAD6E00805D62-B7899D9C0F3C579C86621146C4C74A2',
  clientName: process.env.MEWS_CLIENT_NAME || 'MovaneX AI Kiosk v1.0',

  // IDs de démo issus de ton exemple (à surcharger via variables d’environnement en prod)
  enterpriseId:
    process.env.MEWS_ENTERPRISE_ID || '851df8c8-90f2-4c4a-8e01-a4fc46b25178',
  serviceId:
    process.env.MEWS_SERVICE_ID || '02351c4f-ade2-495e-a0c1-b3770147ca95',
  demoCustomerId:
    process.env.MEWS_CUSTOMER_ID || '92248ad6-3333-44b0-971c-ee62d1e31f3a',
  // Ici on reprend l’ID du device utilisé dans ton exemple pour le paiement
  terminalId:
    process.env.MEWS_TERMINAL_ID || 'd462d42f-faca-458a-a228-b28c01477258',
};

// Corps de base envoyé à tous les endpoints Mews
function baseBody() {
  return {
    ClientToken: MEWS_CONFIG.clientToken,
    AccessToken: MEWS_CONFIG.accessToken,
    Client: MEWS_CONFIG.clientName,
  };
}

// Helper générique pour poster vers Mews
async function mewsPost(path, body) {
  const url = `${MEWS_CONFIG.platformAddress}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Réponse non JSON de Mews (${res.status}): ${text}`);
  }

  if (!res.ok) {
    const msg = `Erreur Mews ${res.status}: ${JSON.stringify(json)}`;
    console.error(msg);
    throw new Error(msg);
  }

  return json;
}

// =========================
// Application Express
// =========================

const app = express();
app.use(cors());
app.use(express.json());

// Simple health-check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// =========================
// SETUP / INIT
// =========================

// 1) Récupérer tous les devices
// POST https://api.mews-demo.com/api/connector/v1/devices/getAll
app.get('/setup/devices', async (req, res) => {
  try {
    const body = baseBody();
    const data = await mewsPost('/api/connector/v1/devices/getAll', body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2) Récupérer la configuration de l’entreprise
// POST https://api.mews-demo.com/api/connector/v1/configuration/get
app.get('/setup/configuration', async (req, res) => {
  try {
    const body = baseBody();
    const data = await mewsPost('/api/connector/v1/configuration/get', body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// PRODUITS / SERVICES
// =========================

// 3) Récupérer les services
// POST https://api.mews-demo.com/api/connector/v1/services/getAll
app.get('/services', async (req, res) => {
  try {
    const body = {
      ...baseBody(),
      EnterpriseIds: [MEWS_CONFIG.enterpriseId],
      Limitation: { Count: 50 },
    };
    const data = await mewsPost('/api/connector/v1/services/getAll', body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4) Récupérer les produits associés à un service
// POST https://api.mews-demo.com/api/connector/v1/products/getAll
app.get('/products', async (req, res) => {
  try {
    const serviceId = req.query.serviceId || MEWS_CONFIG.serviceId;
    const count = req.query.count ? parseInt(req.query.count, 10) : 10;

    const body = {
      ...baseBody(),
      ServiceIds: [serviceId],
      Limitation: { Count: count },
    };

    const data = await mewsPost('/api/connector/v1/products/getAll', body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5) Récupérer les disponibilités d'un service (par catégorie de chambre / ressource)
// POST https://api.mews-demo.com/api/connector/v1/services/getAvailability
app.get('/services/availability', async (req, res) => {
  try {
    const serviceId = req.query.serviceId; // obligatoire
    const firstTimeUnitStartUtc = req.query.firstTimeUnitStartUtc;
    const lastTimeUnitStartUtc = req.query.lastTimeUnitStartUtc;

    if (!serviceId) {
      return res.status(400).json({ error: 'serviceId est requis' });
    }
    if (!firstTimeUnitStartUtc || !lastTimeUnitStartUtc) {
      return res.status(400).json({
        error:
          'firstTimeUnitStartUtc et lastTimeUnitStartUtc sont requis (ISO 8601)',
      });
    }

    const body = {
      ...baseBody(),
      ServiceId: serviceId,
      FirstTimeUnitStartUtc: firstTimeUnitStartUtc,
      LastTimeUnitStartUtc: lastTimeUnitStartUtc,
    };

    const data = await mewsPost(
      '/api/connector/v1/services/getAvailability',
      body
    );
    // data = { DatesUtc, TimeUnitStartsUtc, CategoryAvailabilities: [{CategoryId, Availabilities[], Adjustments[]}, ...] }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =========================
// RÉSERVATIONS
// =========================

// 1) Récupérer des réservations (colliding interval)
// POST https://api.mews-demo.com/api/connector/v1/reservations/getAll
// RÉSERVATIONS - Get all (version 2023-06-06, body correct)
app.get('/reservations', async (req, res) => {
  try {
    const serviceId = req.query.serviceId || MEWSCONFIG.serviceId;
    const startUtc  = req.query.startUtc || '2026-03-01T00:00:00Z';
    const endUtc    = req.query.endUtc   || '2026-04-01T00:00:00Z';
    const count     = req.query.count ? parseInt(req.query.count, 10) : 50;

    const body = {
      ...baseBody(),
      ServiceIds: [serviceId],
      // Filtre par création récente (max 3 mois autorisé)
      CreatedUtc: {
        StartUtc: startUtc,
        EndUtc:   endUtc
      },
      Limitation: { Count: count }
    };

    const data = await mewsPost(
      '/api/connector/v1/reservations/getAll/2023-06-06',
      body
    );
    res.json(data);
  } catch (err) {
    console.error('Erreur /reservations getAll:', err);
    res.status(500).json({ error: err.message });
  }
});



// 2) Créer une réservation
// POST https://api.mews-demo.com/api/connector/v1/reservations/add
// Body attendu côté serveur (JSON) :
// {
//   "serviceId": "bd26d8db-86da-4f96-9efc-e5a4654a4a94",
//   "groupId": null,
//   "groupName": null,
//   "sendConfirmationEmail": true,
//   "reservations": [ { ...payload Mews Reservation... } ]
// }
app.post('/reservations', async (req, res) => {
  try {
    const {
      serviceId,
      groupId = null,
      groupName = null,
      sendConfirmationEmail = true,
      reservations,
    } = req.body;

    if (!serviceId) {
      return res.status(400).json({ error: 'serviceId est requis' });
    }
    if (!Array.isArray(reservations) || reservations.length === 0) {
      return res
        .status(400)
        .json({ error: 'reservations (array) est requis' });
    }

    const body = {
      ...baseBody(),
      ServiceId: serviceId,
      GroupId: groupId,
      GroupName: groupName,
      SendConfirmationEmail: sendConfirmationEmail,
      Reservations: reservations,
    };

    const data = await mewsPost(
      '/api/connector/v1/reservations/add',
      body
    );
    // data = { Reservations: [ { Identifier, Reservation: { ... } }, ... ] }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) Récupérer les tarifs (rates) d’un service
// POST https://api.mews-demo.com/api/connector/v1/rates/getAll
app.get('/rates', async (req, res) => {
  try {
    const serviceId =
      req.query.serviceId || 'bd26d8db-86da-4f96-9efc-e5a4654a4a94';
    const count = req.query.count ? parseInt(req.query.count, 10) : 10;

    const body = {
      ...baseBody(),
      ServiceIds: [serviceId],
      ActivityStates: ['Active'],
      Extent: {
        Rates: true,
        RateGroups: true,
      },
      Limitation: {
        Count: count,
      },
    };

    const data = await mewsPost('/api/connector/v1/rates/getAll', body);
    // data = { Rates: [...], RateGroups: [...], Cursor? }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// PMS HOTEL - RESERVATIONS START (Check-in)
// POST /api/connector/v1/reservations/start
app.post('/reservations/start', async (req, res) => {
  try {
    const { reservationId, enterpriseId = MEWS_CONFIG.enterpriseId } = req.body;
    if (!reservationId) {
      return res.status(400).json({ error: 'reservationId required' });
    }

    const body = {
      ...baseBody(),
      EnterpriseId: enterpriseId,
      ReservationId: reservationId
    };

    const data = await mewsPost('/api/connector/v1/reservations/start', body);
    res.json(data);
  } catch (err) {
    console.error('Erreur /reservations/start', err);
    res.status(500).json({ error: err.message });
  }
});


// ========================================
// PMS HOTEL - RESERVATIONS PROCESS (Check-out)
// POST /api/connector/v1/reservations/process
app.post('/reservations/process', async (req, res) => {
  try {
    const { 
      reservationId, 
      enterpriseId = MEWS_CONFIG.enterpriseId,
      closeBills = false,
      allowOpenBalance = false,
      notes = null 
    } = req.body;
    
    if (!reservationId) {
      return res.status(400).json({ error: 'reservationId required' });
    }

    const body = {
      ...baseBody(),
      EnterpriseId: enterpriseId,
      ReservationId: reservationId,
      CloseBills: closeBills,
      AllowOpenBalance: allowOpenBalance,
      Notes: notes
    };

    const data = await mewsPost('/api/connector/v1/reservations/process', body);
    res.json(data);
  } catch (err) {
    console.error('Erreur /reservations/process', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// PMS HOTEL - RESERVATIONS CANCEL
// POST /api/connector/v1/reservations/cancel
app.post('/reservations/cancel', async (req, res) => {
  try {
    const {
      reservationIds,
      enterpriseId = MEWS_CONFIG.enterpriseId,
      postCancellationFee = false,
      sendEmail = false,
      notes = 'Annulée via MovaneX AI Kiosk PMS',
    } = req.body;

    const ids = Array.isArray(reservationIds)
      ? reservationIds
      : reservationIds
      ? [reservationIds]
      : [];

    if (!ids.length) {
      return res.status(400).json({ error: 'reservationIds array required' });
    }

    const body = {
      ...baseBody(),
      EnterpriseId: enterpriseId,
      ReservationIds: ids,
      PostCancellationFee: postCancellationFee,
      SendEmail: sendEmail,
      Notes: notes,
    };

    const data = await mewsPost(
      '/api/connector/v1/reservations/cancel',
      body
    );
    // data.ReservationIds = [ ... ]
    res.json(data);
  } catch (err) {
    console.error('Erreur /reservations/cancel', err);
    res.status(500).json({ error: err.message });
  }
});


// =========================
// RESSOURCES
// =========================


// 7. Récupérer les ressources (chambres) d'un enterprise/service
// POST https://api.mews-demo.com/api/connector/v1/resources/getAll
app.get('/resources', async (req, res) => {
  try {
    const enterpriseId = MEWS_CONFIG.enterpriseId; // même que dans configuration
    const resourceIds = req.query.resourceIds 
      ? req.query.resourceIds.split(',') 
      : null; // optionnel : liste de ResourceIds filtrés
    const count = req.query.count ? parseInt(req.query.count, 10) : 100;

    // Body de base
    const body = {
      ...baseBody(),
      // ResourceIds est optionnel : si non fourni, Mews renverra toutes les ressources de l’enterprise
      // mais pour rester proche de ton exemple, on le laisse configurable
      Limitation: {
        Count: count,
      },
      Extent: {
        Resources: true,
        ResourceCategories: false,
        ResourceCategoryAssignments: false,
        ResourceCategoryImageAssignments: false,
        ResourceFeatures: false,
        ResourceFeatureAssignments: false,
        Inactive: false,
      },
    };

    if (resourceIds && resourceIds.length > 0) {
      body.ResourceIds = resourceIds;
    }

    const data = await mewsPost('/api/connector/v1/resources/getAll', body);
    // data.Resources = [ { Id, Name, State, Data: { Discriminator: 'Space', Value: { FloorNumber, ... } } }, ... ]
    res.json(data);
  } catch (err) {
    console.error('Erreur /resources', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// PMS HOTEL - RESOURCES UPDATE (état chambre)
// POST /api/connector/v1/resources/update
app.post('/resources/update', async (req, res) => {
  try {
    const updates = req.body.ResourceUpdates || [];
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'ResourceUpdates array required' });
    }

    const body = {
      ...baseBody(),
      ResourceUpdates: updates
    };

    const data = await mewsPost('/api/connector/v1/resources/update', body);
    res.json(data);
  } catch (err) {
    console.error('Erreur /resources/update', err);
    res.status(500).json({ error: err.message });
  }
});

// AVAILABILITY BLOCKS - Lister les blocks qui bloquent
// POST /api/connector/v1/availabilityBlocks/getAll
app.get('/availability-blocks', async (req, res) => {
  try {
    const serviceIds = req.query.serviceIds 
      ? req.query.serviceIds.split(',') 
      : [MEWS_CONFIG.serviceId];  // Par défaut ton hôtel
    
    const startUtc = req.query.startUtc || '2026-03-12T00:00:00Z';
    const endUtc = req.query.endUtc || '2026-03-13T23:59:59Z';
    const count = req.query.count ? parseInt(req.query.count, 10) : 20;

    const body = {
      ...baseBody(),
      ServiceIds: serviceIds,
      Extent: {
        AvailabilityBlocks: true,
        Adjustments: true,
        ServiceOrders: false,
        Rates: false
      },
      CollidingUtc: {
        StartUtc: startUtc,
        EndUtc: endUtc
      },
      Limitation: {
        Count: count
      }
    };

    const data = await mewsPost('/api/connector/v1/availabilityBlocks/getAll', body);
    res.json(data);
  } catch (err) {
    console.error('Erreur /availability-blocks:', err);
    res.status(500).json({ error: err.message });
  }
});

// RESSOURCE CATEGORIES - Récupérer les catégories de chambres / espaces
// POST https://api.mews-demo.com/api/connector/v1/resourceCategories/getAll
app.get('/resource-categories', async (req, res) => {
  try {
    // ServiceId : soit query, soit config par défaut
    const serviceId = req.query.serviceId || MEWS_CONFIG.serviceId;
    const count = req.query.count ? parseInt(req.query.count, 10) : 50;

    const body = {
      ...baseBody(),
      ServiceIds: [serviceId],
      Limitation: {
        Count: count,
      },
    };

    const data = await mewsPost(
      '/api/connector/v1/resourceCategories/getAll',
      body
    );

    // data = { ResourceCategories: [...], Cursor: ... }
    res.json(data);
  } catch (err) {
    console.error('Erreur /resource-categories:', err);
    res.status(500).json({ error: err.message });
  }
});



// =========================
// CLIENTS
// =========================

// 5) Récupérer des clients (fenêtre CreatedUtc et limitation)
// POST https://api.mews-demo.com/api/connector/v1/customers/getAll
app.get('/customers', async (req, res) => {
  try {
    const startUtc = req.query.startUtc || '2018-01-01T00:00:00Z';
    const endUtc = req.query.endUtc || '2018-01-30T00:00:00Z';
    const count = req.query.count ? parseInt(req.query.count, 10) : 10;

    const body = {
      ...baseBody(),
      CreatedUtc: {
        StartUtc: startUtc,
        EndUtc: endUtc,
      },
      Extent: {
        Customers: true,
        Documents: false,
        Addresses: false,
      },
      ActivityStates: ['Active'],
      Limitation: {
        Count: count,
      },
    };

    const data = await mewsPost('/api/connector/v1/customers/getAll', body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6) Récupérer les catégories d'âge (AgeCategories)
// POST https://api.mews-demo.com/api/connector/v1/ageCategories/getAll
app.get('/age-categories', async (req, res) => {
  try {
    const enterpriseId = req.query.enterpriseId || MEWS_CONFIG.enterpriseId;
    const serviceId =
      req.query.serviceId || 'bd26d8db-86da-4f96-9efc-e5a4654a4a94';
    const count = req.query.count ? parseInt(req.query.count, 10) : 10;

    const body = {
      ...baseBody(),
      EnterpriseIds: [enterpriseId],
      ServiceIds: [serviceId],
      ActivityStates: ['Active'],
      Limitation: { Count: count },
    };

    const data = await mewsPost(
      '/api/connector/v1/ageCategories/getAll',
      body
    );
    // data = { AgeCategories: [ {Id, MinimalAge, MaximalAge, Names, Classification, ...}, ... ], Cursor? }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =========================
// COMMANDES (ORDERS POS)
// =========================

// 6) Créer une commande POS (order)
// POST https://api.mews-demo.com/api/connector/v1/orders/add
// Body attendu côté serveur (JSON) :
// {
//   "accountId": "uuid du client",
//   "serviceId": "uuid du service (optionnel, sinon valeur par défaut)",
//   "enterpriseId": "uuid de l'entreprise (optionnel)",
//   "productOrders": [ ... ]  (optionnel, conforme à la doc Mews),
//   "items": [ ... ]          (optionnel, conforme à la doc Mews)
// }
app.post('/orders', async (req, res) => {
  try {
    const { accountId, serviceId, enterpriseId, items } = req.body;

    const finalAccountId = accountId || MEWS_CONFIG.demoCustomerId;
    const finalServiceId = serviceId || MEWS_CONFIG.serviceId;
    const finalEnterpriseId = enterpriseId || MEWS_CONFIG.enterpriseId;

    if (!finalAccountId) {
      return res.status(400).json({ error: 'accountId est requis' });
    }

    // ✅ Mapper items vers format Mews ProductOrder
    const productOrders = items.map(item => ({
      ProductId: item.productId,  // optionnel, si fourni
      UnitCount: item.quantity || 1,
      UnitAmount: {
        Currency: "GBP",  // fixe pour démo
        Value: item.unitPrice || 1.20,  // fallback prix Rooh Afza
        GrossValue: item.unitPrice || 1.20,  // TTC
        TaxValues: [{
          Code: "UK-2022-20%",  // ex. UK VAT
          Value: (item.unitPrice || 1.20) * 0.2
        }]
      }
    }));

    const body = {
      ...baseBody(),
      EnterpriseId: finalEnterpriseId,
      ServiceId: finalServiceId,
      AccountId: finalAccountId,
      ProductOrders: productOrders  // ✅ Mews attend ÇA
    };

    console.log("[MEWS] POST /api/connector/v1/orders/add body=", JSON.stringify(body, null, 2));

    const data = await mewsPost('/api/connector/v1/orders/add', body);
    res.json(data);
  } catch (err) {
    console.error("[ORDERS] Erreur:", err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// PAIEMENTS / TERMINAL
// =========================

// 7) Récupérer les commandes de devices actives (fiscal machine / terminal, etc.)
// POST https://api.mews-demo.com/api/connector/v1/commands/getAllActive
app.get('/payments/commands/active', async (req, res) => {
  try {
    const body = baseBody();
    const data = await mewsPost('/api/connector/v1/commands/getAllActive', body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8) Envoyer une commande vers le terminal de paiement
// POST https://api.mews-demo.com/api/connector/v1/commands/addPaymentTerminal
// Body attendu côté serveur (JSON) :
// {
//   "customerId": "uuid du customer",
//   "terminalId": "uuid du device (optionnel, sinon valeur par défaut)",
//   "billId": "uuid du bill ou null",
//   "amount": 230.00,
//   "currency": "EUR"
// }
app.post('/payments/terminal-command', async (req, res) => {
  try {
    const {
      customerId,
      terminalId,
      billId = null,
      amount,
      currency = 'EUR',
    } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId est requis' });
    }
    if (typeof amount !== 'number') {
      return res.status(400).json({ error: 'amount (number) est requis' });
    }

    const body = {
      ...baseBody(),
      Type: 'Payment',
      TerminalId: terminalId || MEWS_CONFIG.terminalId,
      CustomerId: customerId,
      BillId: billId,
      Amount: {
        Currency: currency,
        Value: amount,
      },
    };

    const data = await mewsPost(
      '/api/connector/v1/commands/addPaymentTerminal',
      body
    );
    // data = { CommandId }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// DEMO FLOW : simulateur de parcours borne
// =========================
//
// GET /demo/flow
// Query params optionnels :
//   customerId, amount, currency
//
// Étapes :
//   1) devices/getAll
//   2) configuration/get
//   3) services/getAll
//   4) customers/getAll (fenêtre fixe de démo)
//   5) orders/add pour le customer choisi (sans détails produits pour rester simple)
//   6) commands/addPaymentTerminal pour lancer un paiement

app.get('/demo/flow', async (req, res) => {
  try {
    const demoCustomerId = req.query.customerId || MEWS_CONFIG.demoCustomerId;
    const amount = req.query.amount ? Number(req.query.amount) : 230.0;
    const currency = req.query.currency || 'EUR';

    // 1) Devices
    const devices = await mewsPost(
      '/api/connector/v1/devices/getAll',
      baseBody()
    );

    // 2) Configuration
    const configuration = await mewsPost(
      '/api/connector/v1/configuration/get',
      baseBody()
    );

    // 3) Services
    const services = await mewsPost(
      '/api/connector/v1/services/getAll',
      {
        ...baseBody(),
        EnterpriseIds: [MEWS_CONFIG.enterpriseId],
        Limitation: { Count: 50 },
      }
    );

    // 4) Customers (on récupère 1 client actif pour la démo)
    const customers = await mewsPost(
      '/api/connector/v1/customers/getAll',
      {
        ...baseBody(),
        CreatedUtc: {
          StartUtc: '2018-01-01T00:00:00Z',
          EndUtc: '2018-01-30T00:00:00Z',
        },
        Extent: {
          Customers: true,
          Documents: false,
          Addresses: false,
        },
        ActivityStates: ['Active'],
        Limitation: { Count: 10 },
      }
    );

    const customerFromList =
      customers.Customers && customers.Customers.length > 0
        ? customers.Customers[0].Id
        : null;

    const customerIdToUse = customerFromList || demoCustomerId;

    // 5) Création d'une commande simple pour ce customer
    const order = await mewsPost('/api/connector/v1/orders/add', {
      ...baseBody(),
      EnterpriseId: MEWS_CONFIG.enterpriseId,
      ServiceId: MEWS_CONFIG.serviceId,
      AccountId: customerIdToUse,
      // On peut ajouter ici ProductOrders ou Items si besoin plus tard
    });

    // 6) Lancement d’une commande vers le terminal de paiement
    const paymentCommand = await mewsPost(
      '/api/connector/v1/commands/addPaymentTerminal',
      {
        ...baseBody(),
        Type: 'Payment',
        TerminalId: MEWS_CONFIG.terminalId,
        CustomerId: customerIdToUse,
        BillId: null,
        Amount: {
          Currency: currency,
          Value: amount,
        },
      }
    );

    res.json({
      info: 'Demo flow terminé',
      customerIdUsed: customerIdToUse,
      order,
      paymentCommand,
      devices,
      configuration,
      services,
    });
  } catch (err) {
    console.error('Erreur demo/flow', err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// Lancement du serveur
// =========================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mews kiosk test server démarré sur http://localhost:${PORT}`);
});
