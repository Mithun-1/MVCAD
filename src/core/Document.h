#pragma once
#include "PointWorkflow.h"
#include "cad/CadModel.h"
#include <QJsonObject>
namespace mvcad {
struct CurveDefinition {
    QString id;
    std::vector<QString> pointIds;
    bool closed=false;
    QString mirrorSource,mirrorAxis;
};
struct BodyDisplay {
    QString bodyId;
    bool hidden=false;
    double opacity=1;
};
struct PointSet { QString id; bool hidden=false; };
struct Document {
    Network network;
    std::vector<ImportedPoint> points;
    CadModel cad;
    double junctionRadius=0;
    std::vector<CurveDefinition> curveDefinitions;
    std::vector<BodyDisplay> bodyDisplay;
    std::vector<PointSet> pointSets;
    std::vector<QString> hiddenCurves;
};
QJsonObject serializeDocument(const Document& document);
Document deserializeDocument(const QJsonObject& object);
void saveDocument(const QString& path,const Document& document);
Document loadDocument(const QString& path);
}
