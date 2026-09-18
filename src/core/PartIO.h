#pragma once
#include "Network.h"
#include <QJsonObject>

namespace mvcad {
QJsonObject serializePart(const Network& n);
Network deserializePart(const QJsonObject& object);
void savePart(const QString& path,const Network& n);
Network loadPart(const QString& path);
}
