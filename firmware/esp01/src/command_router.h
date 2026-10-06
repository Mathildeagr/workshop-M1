#pragma once

#include "alert_policy.h"
#include "command.h"

// Traduit les messages recus sur le topic de commande en actions locales.
// Une commande inconnue est ignoree sans bruit : le topic peut porter des
// instructions destinees a d'autres briques.
class CommandRouter : public ICommandSink {
public:
  explicit CommandRouter(AlertPolicy &policy) : _policy(policy) {}

  void onCommand(const char *payload, size_t length) override;

private:
  AlertPolicy &_policy;
};
