#include "Document.h"
#include "PartIO.h"
#include <QFile>
#include <QSaveFile>
#include <QJsonDocument>
#include <QJsonArray>
#include <QSet>
#include <cmath>
#include <stdexcept>

namespace mvcad {
namespace {
[[noreturn]] void fail(const QString& message){throw std::runtime_error(message.toStdString());}
double number(const QJsonValue& value){if(!value.isDouble()||!std::isfinite(value.toDouble()))fail("Expected a finite numeric document parameter.");return value.toDouble();}
int integer(const QJsonValue& value,int minimum,int maximum){const auto result=number(value);if(result<minimum||result>maximum||result!=std::floor(result))fail("Invalid document enumeration or index.");return static_cast<int>(result);}

void validateFeature(const CadFeature& feature,const CadModel& model){
    if(feature.id.isEmpty()||feature.id=="vessels")fail("Feature identifiers must be nonempty and cannot use the reserved vessels identifier.");
    if(feature.operation!=CadOperation::Boss&&feature.operation!=CadOperation::Cut&&feature.operation!=CadOperation::Fillet&&feature.operation!=CadOperation::DeleteBody)fail("Invalid CAD feature operation.");
    if(feature.extent!=CadExtent::Blind&&feature.extent!=CadExtent::ThroughAll&&feature.extent!=CadExtent::MidPlane&&feature.extent!=CadExtent::TwoDirections)fail("Invalid CAD feature extent.");
    if(feature.bodyMode!=CadBodyMode::Merge&&feature.bodyMode!=CadBodyMode::NewBody)fail("Invalid CAD body mode.");
    if(!std::isfinite(feature.depth)||!std::isfinite(feature.secondDepth)||!std::isfinite(feature.startOffset)||!std::isfinite(feature.filletRadius)||feature.secondDepth<0||feature.filletRadius<0)fail("Invalid finite CAD feature parameter.");
    if(feature.operation==CadOperation::Boss||feature.operation==CadOperation::Cut){
        if(feature.sketch<0||feature.sketch>=static_cast<int>(model.sketches.size()))fail("CAD feature refers to an invalid sketch.");
        if(feature.operation==CadOperation::Boss&&feature.extent==CadExtent::ThroughAll)fail("Through All is only valid for cuts.");
        if(feature.operation==CadOperation::Cut&&feature.bodyMode==CadBodyMode::NewBody)fail("A cut cannot create a new body.");
        if(feature.operation==CadOperation::Boss&&feature.bodyMode==CadBodyMode::NewBody&&!feature.targetBody.isEmpty())fail("A New Body boss cannot specify a target body.");
        if(feature.extent==CadExtent::TwoDirections){if(feature.depth<0||(feature.depth==0&&feature.secondDepth==0))fail("A two-direction extrusion requires at least one positive depth.");}
        else if(feature.depth<=0)fail("Extrusion depth must be positive.");
    }else if(feature.sketch!=-1||feature.bodyMode!=CadBodyMode::Merge)fail("Fillet and Delete Body features cannot reference a sketch or create a body.");
    if(feature.operation==CadOperation::Fillet){
        if(feature.targetBody.isEmpty()||feature.filletRadius<=0||feature.edgeIds.empty())fail("A fillet requires a target body, positive radius, and selected edges.");
        QSet<QString> ids;for(const auto& id:feature.edgeIds)if(id.isEmpty()||ids.contains(id))fail("Fillet edge identifiers must be nonempty and unique.");else ids.insert(id);
    }
    if(feature.operation==CadOperation::DeleteBody&&feature.targetBody.isEmpty())fail("Delete Body requires an explicit target body.");
}

void validateDefinitions(const Document& document,const QSet<QString>& pointIds){
    if(document.curveDefinitions.empty())return;
    if(document.curveDefinitions.size()!=document.network.curves.size())fail("Curve definitions must correspond one-to-one with network curves.");
    QSet<QString> definitionIds,networkIds;for(const auto& curve:document.network.curves)networkIds.insert(curve.id);
    for(const auto& definition:document.curveDefinitions){
        if(definition.id.isEmpty()||definitionIds.contains(definition.id)||(definition.mirrorSource.isEmpty()&&definition.pointIds.size()<2))fail("Curve definitions require unique identifiers and at least two point references.");
        definitionIds.insert(definition.id);for(const auto& id:definition.pointIds)if(id.isEmpty()||!pointIds.contains(id))fail("Curve definition refers to a missing imported point.");
    }
    if(definitionIds!=networkIds)fail("Curve definition identifiers must match network curve identifiers.");
}
} // namespace

QJsonObject serializeDocument(const Document& document){
    if(!std::isfinite(document.junctionRadius)||document.junctionRadius<0)fail("Invalid junction rounding radius.");
    QJsonArray points,definitions,sketches,features,bodyDisplay,pointSets,hiddenCurves;QSet<QString> pointIds,sketchIds,featureIds,displayIds;
    for(const auto& point:document.points){if(point.id.isEmpty()||pointIds.contains(point.id)||!point.position.finite())fail("Invalid imported point.");pointIds.insert(point.id);points.append(QJsonObject{{"id",point.id},{"position",QJsonArray{point.position.x,point.position.y,point.position.z}},{"setId",point.setId},{"hidden",point.hidden}});}
    validateDefinitions(document,pointIds);
    for(const auto& definition:document.curveDefinitions){QJsonArray references;for(const auto& id:definition.pointIds)references.append(id);definitions.append(QJsonObject{{"id",definition.id},{"pointIds",references},{"closed",definition.closed},{"mirrorSource",definition.mirrorSource},{"mirrorAxis",definition.mirrorAxis}});}
    for(const auto& sketch:document.cad.sketches){
        if(sketch.id.isEmpty()||sketchIds.contains(sketch.id)||!std::isfinite(sketch.offset)||!std::isfinite(sketch.radius))fail("Invalid sketch.");sketchIds.insert(sketch.id);QJsonArray vertices;
        for(auto point:sketch.points){if(!std::isfinite(point.x())||!std::isfinite(point.y()))fail("Nonfinite sketch point.");vertices.append(QJsonArray{point.x(),point.y()});}
        sketches.append(QJsonObject{{"id",sketch.id},{"plane",static_cast<int>(sketch.plane)},{"offset",sketch.offset},{"profile",static_cast<int>(sketch.profile)},{"radius",sketch.radius},{"points",vertices}});
    }
    for(const auto& feature:document.cad.features){
        validateFeature(feature,document.cad);if(featureIds.contains(feature.id))fail("Feature identifiers must be unique.");featureIds.insert(feature.id);QJsonArray edges;for(const auto& id:feature.edgeIds)edges.append(id);
        features.append(QJsonObject{{"id",feature.id},{"sketch",feature.sketch},{"operation",static_cast<int>(feature.operation)},{"extent",static_cast<int>(feature.extent)},{"depth",feature.depth},{"reversed",feature.reversed},{"secondDepth",feature.secondDepth},{"startOffset",feature.startOffset},{"bodyMode",static_cast<int>(feature.bodyMode)},{"targetBody",feature.targetBody},{"filletRadius",feature.filletRadius},{"edgeIds",edges}});
    }
    for(const auto& display:document.bodyDisplay){if(display.bodyId.isEmpty()||displayIds.contains(display.bodyId)||!std::isfinite(display.opacity)||display.opacity<0||display.opacity>1)fail("Invalid body display state.");displayIds.insert(display.bodyId);bodyDisplay.append(QJsonObject{{"bodyId",display.bodyId},{"hidden",display.hidden},{"opacity",display.opacity}});}
    if(document.pointSets.size()>50000||document.hiddenCurves.size()>1000)fail("Too many reference display entries.");
    QSet<QString> setIds;for(const auto& set:document.pointSets){if(set.id.isEmpty()||setIds.contains(set.id))fail("Point set names must be unique.");setIds.insert(set.id);pointSets.append(QJsonObject{{"id",set.id},{"hidden",set.hidden}});}
    for(const auto& point:document.points)if(!point.setId.isEmpty()&&!setIds.contains(point.setId))fail("Point refers to a missing set.");
    for(const auto& id:document.hiddenCurves)hiddenCurves.append(id);
    for(const auto& d:document.curveDefinitions)if(!d.mirrorSource.isEmpty()&&(d.mirrorAxis.isEmpty()||!d.pointIds.empty()||d.id==d.mirrorSource||d.id==d.mirrorAxis))fail("Invalid mirror definition.");
    return {{"format","MVCAD-Part"},{"schemaVersion",4},{"dimensionless",true},{"network",serializePart(document.network)},{"importedPoints",points},{"curveDefinitions",definitions},{"sketches",sketches},{"features",features},{"bodyDisplay",bodyDisplay},{"junctionRadius",document.junctionRadius},{"pointSets",pointSets},{"hiddenCurves",hiddenCurves}};
}

Document deserializeDocument(const QJsonObject& object){
    Document document;const auto version=object["schemaVersion"].toDouble(-1);
    if(version==1){document.network=deserializePart(object);return document;}
    if(object["format"]!="MVCAD-Part"||(version!=2&&version!=3&&version!=4)||!object["dimensionless"].isBool()||!object["dimensionless"].toBool())fail("Unsupported MVCAD part format.");
    if(!object["network"].isObject()||!object["importedPoints"].isArray()||!object["sketches"].isArray()||!object["features"].isArray())fail("Incomplete document.");
    document.network=deserializePart(object["network"].toObject());document.junctionRadius=object.contains("junctionRadius")?number(object["junctionRadius"]):0;
    if(object["importedPoints"].toArray().size()>50000||object["sketches"].toArray().size()>1000||object["features"].toArray().size()>1000)fail("Document exceeds supported entity limits.");
    for(auto value:object["importedPoints"].toArray()){const auto record=value.toObject();const auto position=record["position"].toArray();if(position.size()!=3||!record["id"].isString()||(record.contains("hidden")&&!record["hidden"].isBool())||(record.contains("setId")&&!record["setId"].isString()))fail("Invalid imported point record.");document.points.push_back({record["id"].toString(),{number(position[0]),number(position[1]),number(position[2])},record["setId"].toString(),record["hidden"].toBool(false)});}
    if(version>=3&&object.contains("curveDefinitions")){
        if(!object["curveDefinitions"].isArray()||object["curveDefinitions"].toArray().size()>1000)fail("Invalid curve definition array.");
        for(auto value:object["curveDefinitions"].toArray()){const auto record=value.toObject();CurveDefinition definition;definition.id=record["id"].toString();if(!record["pointIds"].isArray()||record["pointIds"].toArray().size()>50000||!record["closed"].isBool())fail("Invalid curve definition record.");for(auto id:record["pointIds"].toArray())if(!id.isString())fail("Invalid curve point reference.");else definition.pointIds.push_back(id.toString());definition.closed=record["closed"].toBool();definition.mirrorSource=record["mirrorSource"].toString();definition.mirrorAxis=record["mirrorAxis"].toString();document.curveDefinitions.push_back(std::move(definition));}
    }
    for(auto value:object["sketches"].toArray()){
        const auto record=value.toObject();Sketch sketch;sketch.id=record["id"].toString();sketch.plane=static_cast<Plane>(integer(record["plane"],0,2));sketch.profile=static_cast<ProfileType>(integer(record["profile"],0,2));sketch.offset=number(record["offset"]);sketch.radius=number(record["radius"]);
        if(!record["points"].isArray()||record["points"].toArray().size()>10000)fail("Invalid sketch point array.");for(auto pointValue:record["points"].toArray()){const auto point=pointValue.toArray();if(point.size()!=2)fail("Invalid sketch point.");sketch.points.push_back({number(point[0]),number(point[1])});}document.cad.sketches.push_back(std::move(sketch));
    }
    for(auto value:object["features"].toArray()){
        const auto record=value.toObject();CadFeature feature;feature.id=record["id"].toString();feature.sketch=record.contains("sketch")?integer(record["sketch"],-1,static_cast<int>(document.cad.sketches.size())-1):-1;feature.operation=static_cast<CadOperation>(integer(record["operation"],0,version==2?1:3));feature.extent=static_cast<CadExtent>(integer(record["extent"],0,version==2?2:3));feature.depth=number(record["depth"]);if(!record["reversed"].isBool())fail("Invalid feature direction.");feature.reversed=record["reversed"].toBool();
        if(version>=3){feature.secondDepth=record.contains("secondDepth")?number(record["secondDepth"]):0;feature.startOffset=record.contains("startOffset")?number(record["startOffset"]):0;feature.bodyMode=static_cast<CadBodyMode>(record.contains("bodyMode")?integer(record["bodyMode"],0,1):0);feature.targetBody=record["targetBody"].toString();feature.filletRadius=record.contains("filletRadius")?number(record["filletRadius"]):0;if(record.contains("edgeIds")){if(!record["edgeIds"].isArray()||record["edgeIds"].toArray().size()>10000)fail("Invalid fillet edge identifiers.");for(auto id:record["edgeIds"].toArray())if(!id.isString())fail("Invalid fillet edge identifier.");else feature.edgeIds.push_back(id.toString());}}
        document.cad.features.push_back(std::move(feature));
    }
    if(version>=3&&object.contains("bodyDisplay")){
        if(!object["bodyDisplay"].isArray()||object["bodyDisplay"].toArray().size()>1001)fail("Invalid body display array.");for(auto value:object["bodyDisplay"].toArray()){const auto record=value.toObject();BodyDisplay display;display.bodyId=record["bodyId"].toString();if(!record["hidden"].isBool())fail("Invalid body visibility state.");display.hidden=record["hidden"].toBool();display.opacity=number(record["opacity"]);document.bodyDisplay.push_back(std::move(display));}
    }
    if(version>=4){
        if(!object["pointSets"].isArray()||!object["hiddenCurves"].isArray())fail("Invalid entity display data.");
        for(auto value:object["pointSets"].toArray()){auto r=value.toObject();if(!r["hidden"].isBool())fail("Invalid point set visibility.");document.pointSets.push_back({r["id"].toString(),r["hidden"].toBool()});}
        for(auto id:object["hiddenCurves"].toArray()){if(!id.isString())fail("Invalid curve visibility.");document.hiddenCurves.push_back(id.toString());}
    }
    (void)serializeDocument(document);return document;
}

void saveDocument(const QString& path,const Document& document){const auto bytes=QJsonDocument(serializeDocument(document)).toJson();QSaveFile file(path);if(!file.open(QIODevice::WriteOnly)||file.write(bytes)!=bytes.size()||!file.commit())fail("Could not save part atomically: "+file.errorString());}
Document loadDocument(const QString& path){QFile file(path);if(!file.open(QIODevice::ReadOnly))fail(file.errorString());if(file.size()>32*1024*1024)fail("Part exceeds 32 MB.");QJsonParseError error;const auto json=QJsonDocument::fromJson(file.readAll(),&error);if(error.error!=QJsonParseError::NoError||!json.isObject())fail("Invalid part JSON.");return deserializeDocument(json.object());}
} // namespace mvcad
