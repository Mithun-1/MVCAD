#include "Document.h"
#include "PartIO.h"
#include <QFile>
#include <QSaveFile>
#include <QJsonDocument>
#include <QJsonArray>
#include <QSet>
#include <stdexcept>
namespace mvcad {
static void fail(const QString& s){throw std::runtime_error(s.toStdString());}
static double number(const QJsonValue& v){if(!v.isDouble()||!std::isfinite(v.toDouble()))fail("Expected a finite numeric document parameter.");return v.toDouble();}
static int integer(const QJsonValue& v,int min,int max){double d=number(v);if(d<min||d>max||d!=std::floor(d))fail("Invalid document enumeration or index.");return static_cast<int>(d);}
QJsonObject serializeDocument(const Document& d) {
    if(!std::isfinite(d.junctionRadius)||d.junctionRadius<0)fail("Invalid junction rounding radius.");
    QJsonArray points,sketches,features;QSet<QString> pointIds,sketchIds,featureIds;
    for(const auto& p:d.points){if(p.id.isEmpty()||pointIds.contains(p.id)||!p.position.finite())fail("Invalid imported point.");pointIds.insert(p.id);points.append(QJsonObject{{"id",p.id},{"position",QJsonArray{p.position.x,p.position.y,p.position.z}}});}
    for(const auto& s:d.cad.sketches){
        if(s.id.isEmpty()||sketchIds.contains(s.id)||!std::isfinite(s.offset)||!std::isfinite(s.radius))fail("Invalid sketch.");sketchIds.insert(s.id);
        QJsonArray vertices;for(auto p:s.points){if(!std::isfinite(p.x())||!std::isfinite(p.y()))fail("Nonfinite sketch point.");vertices.append(QJsonArray{p.x(),p.y()});}
        sketches.append(QJsonObject{{"id",s.id},{"plane",static_cast<int>(s.plane)},{"offset",s.offset},{"profile",static_cast<int>(s.profile)},{"radius",s.radius},{"points",vertices}});
    }
    for(const auto& f:d.cad.features){
        if(f.id.isEmpty()||featureIds.contains(f.id)||!std::isfinite(f.depth)||f.depth<=0||f.sketch<0||f.sketch>=static_cast<int>(d.cad.sketches.size()))fail("Invalid feature.");featureIds.insert(f.id);
        features.append(QJsonObject{{"id",f.id},{"sketch",f.sketch},{"operation",static_cast<int>(f.operation)},{"extent",static_cast<int>(f.extent)},{"depth",f.depth},{"reversed",f.reversed}});
    }
    return {{"format","MVCAD-Part"},{"schemaVersion",2},{"dimensionless",true},{"network",serializePart(d.network)},{"importedPoints",points},{"sketches",sketches},{"features",features},{"junctionRadius",d.junctionRadius}};
}
Document deserializeDocument(const QJsonObject& o) {
    Document d;
    if(o["schemaVersion"].toDouble(-1)==1){d.network=deserializePart(o);return d;}
    if(o["format"]!="MVCAD-Part"||o["schemaVersion"].toDouble(-1)!=2||!o["dimensionless"].isBool()||!o["dimensionless"].toBool())fail("Unsupported MVCAD part format.");
    if(!o["network"].isObject()||!o["importedPoints"].isArray()||!o["sketches"].isArray()||!o["features"].isArray())fail("Incomplete document.");
    d.network=deserializePart(o["network"].toObject());
    d.junctionRadius=o.contains("junctionRadius")?number(o["junctionRadius"]):0;
    if(o["importedPoints"].toArray().size()>50000||o["sketches"].toArray().size()>1000||o["features"].toArray().size()>1000)fail("Document exceeds supported entity limits.");
    for(auto v:o["importedPoints"].toArray()){auto p=v.toObject();auto a=p["position"].toArray();if(a.size()!=3||!p["id"].isString())fail("Invalid imported point record.");d.points.push_back({p["id"].toString(),{number(a[0]),number(a[1]),number(a[2])}});}
    for(auto v:o["sketches"].toArray()){
        auto s=v.toObject();Sketch sketch;sketch.id=s["id"].toString();sketch.plane=static_cast<Plane>(integer(s["plane"],0,2));sketch.profile=static_cast<ProfileType>(integer(s["profile"],0,2));sketch.offset=number(s["offset"]);sketch.radius=number(s["radius"]);
        if(!s["points"].isArray()||s["points"].toArray().size()>10000)fail("Invalid sketch point array.");
        for(auto pv:s["points"].toArray()){auto a=pv.toArray();if(a.size()!=2)fail("Invalid sketch point.");sketch.points.push_back({number(a[0]),number(a[1])});}
        d.cad.sketches.push_back(sketch);
    }
    for(auto v:o["features"].toArray()){
        auto f=v.toObject();CadFeature feature;feature.id=f["id"].toString();feature.sketch=integer(f["sketch"],0,static_cast<int>(d.cad.sketches.size())-1);feature.operation=static_cast<CadOperation>(integer(f["operation"],0,1));feature.extent=static_cast<CadExtent>(integer(f["extent"],0,2));feature.depth=number(f["depth"]);if(!f["reversed"].isBool())fail("Invalid feature direction.");feature.reversed=f["reversed"].toBool();d.cad.features.push_back(feature);
    }
    (void)serializeDocument(d);return d;
}
void saveDocument(const QString& path,const Document& d){
    const auto bytes=QJsonDocument(serializeDocument(d)).toJson();QSaveFile f(path);
    if(!f.open(QIODevice::WriteOnly)||f.write(bytes)!=bytes.size()||!f.commit())fail("Could not save part atomically: "+f.errorString());
}
Document loadDocument(const QString& path){QFile f(path);if(!f.open(QIODevice::ReadOnly))fail(f.errorString());if(f.size()>32*1024*1024)fail("Part exceeds 32 MB.");QJsonParseError error;auto json=QJsonDocument::fromJson(f.readAll(),&error);if(error.error!=QJsonParseError::NoError||!json.isObject())fail("Invalid part JSON.");return deserializeDocument(json.object());}
}
