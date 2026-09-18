#pragma once
#include "PointWorkflow.h"
#include "cad/CadModel.h"
#include <QJsonObject>
namespace mvcad {
struct Document { Network network; std::vector<ImportedPoint> points; CadModel cad; double junctionRadius=0; };
QJsonObject serializeDocument(const Document& document);
Document deserializeDocument(const QJsonObject& object);
void saveDocument(const QString& path,const Document& document);
Document loadDocument(const QString& path);
}
