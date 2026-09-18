#include "PartIO.h"
#include <QFile>
#include <QSaveFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSet>
#include <limits>
#include <algorithm>
#include <stdexcept>

namespace mvcad {
static void fail(const QString& s){throw std::runtime_error(s.toStdString());}
static bool same(Vec3 a,Vec3 b) { return a.x==b.x&&a.y==b.y&&a.z==b.z; }

static void validateForSave(const Network& n) {
    if(!std::isfinite(n.tolerance)||n.tolerance<=0) fail("Connection tolerance must be positive and finite.");
    if(n.curves.empty()) {
        if(!n.nodes.empty()||!n.branches.empty()||n.components!=0) fail("Empty part contains derived network data.");
        return;
    }
    auto rebuilt=buildNetwork(n.curves,n.tolerance);
    if(rebuilt.components!=n.components||rebuilt.nodes.size()!=n.nodes.size()||rebuilt.branches.size()!=n.branches.size())
        fail("Network topology is inconsistent with its source curves.");
    for(size_t i=0;i<n.nodes.size();++i)
        if(!same(rebuilt.nodes[i].point,n.nodes[i].point)||rebuilt.nodes[i].degree!=n.nodes[i].degree)
            fail("Network nodes are inconsistent with their source curves.");
    for(size_t i=0;i<n.branches.size();++i) {
        const auto& source=n.branches[i];
        const auto& derived=rebuilt.branches[i];
        if(source.id!=derived.id||source.start!=derived.start||source.end!=derived.end||source.points.size()!=derived.points.size())
            fail("Network branches are inconsistent with their source curves.");
        for(size_t j=0;j<source.points.size();++j) if(!same(source.points[j],derived.points[j]))
            fail("Network branch geometry is inconsistent with its source curves.");
        if(!std::isfinite(source.diameter)||source.diameter<0) fail("Branch diameter must be nonnegative and finite.");
        setBranchParameters(rebuilt,static_cast<int>(i),source.diameter==0?1:source.diameter,
                            source.startSetback,source.endSetback);
    }
}

QJsonObject serializePart(const Network& n) {
    validateForSave(n);
    QJsonArray curves,settings;
    for(const auto& c:n.curves) {
        QJsonArray points;
        for(auto p:c.points) points.append(QJsonArray{p.x,p.y,p.z});
        curves.append(QJsonObject{{"id",c.id},{"points",points}});
    }
    for(const auto& b:n.branches) settings.append(QJsonObject{{"id",b.id},{"diameter",b.diameter},
        {"startSetback",b.startSetback},{"endSetback",b.endSetback}});
    return {{"format","MVCAD-Part"},{"schemaVersion",1},{"dimensionless",true},
        {"connectionTolerance",n.tolerance},{"curves",curves},{"branches",settings}};
}
Network deserializePart(const QJsonObject& obj) {
    if(obj["format"]!="MVCAD-Part" || obj["schemaVersion"].toDouble(-1)!=1)
        fail("Unsupported MVCAD part format or schema version.");
    if(!obj["dimensionless"].isBool() || !obj["dimensionless"].toBool()) fail("Expected a dimensionless part.");
    auto number=[](const QJsonValue& v) {
        if(!v.isDouble() || !std::isfinite(v.toDouble())) fail("Part parameters must be finite numbers.");
        return v.toDouble();
    };
    if(!obj["curves"].isArray() || !obj["branches"].isArray()) fail("Missing curves or branch parameters.");
    std::vector<Curve> curves;
    for(const auto& cv:obj["curves"].toArray()) {
        const auto co=cv.toObject();
        if(!co["id"].isString() || !co["points"].isArray()) fail("Invalid curve record.");
        Curve c{co["id"].toString(),{}};
        for(const auto& pv:co["points"].toArray()) {
            const auto a=pv.toArray(); if(a.size()!=3) fail("Each point requires x, y, z.");
            c.points.push_back({number(a[0]),number(a[1]),number(a[2])});
        }
        curves.push_back(std::move(c));
    }
    if(curves.empty()) {
        if(!obj["branches"].toArray().isEmpty()) fail("An empty part cannot have branches.");
        Network n; n.tolerance=number(obj["connectionTolerance"]);
        if(n.tolerance<=0) fail("Connection tolerance must be positive.");
        return n;
    }
    auto n=buildNetwork(curves,number(obj["connectionTolerance"]));
    const auto parameters=obj["branches"].toArray();
    if(parameters.size()!=static_cast<qsizetype>(n.branches.size())) fail("Branch parameter count does not match topology.");
    QSet<QString> seen;
    for(const auto& v:parameters) {
        auto b=v.toObject(); const auto id=b["id"].toString();
        if(id.isEmpty()||seen.contains(id)) fail("Invalid or duplicate branch parameter id.");
        seen.insert(id);
        auto it=std::find_if(n.branches.begin(),n.branches.end(),[&](const auto& x){return x.id==id;});
        if(it==n.branches.end()) fail("Branch parameter id does not match topology.");
        const double d=number(b["diameter"]);
        if(d<0) fail("A diameter cannot be negative.");
        setBranchParameters(n,static_cast<int>(it-n.branches.begin()),d==0?1:d,number(b["startSetback"]),number(b["endSetback"]));
        it->diameter=d;
    }
    return n;
}
void savePart(const QString& path,const Network& n) {
    const auto data=QJsonDocument(serializePart(n)).toJson(QJsonDocument::Indented);
    QSaveFile file(path);
    if(!file.open(QIODevice::WriteOnly)) fail(file.errorString());
    if(file.write(data)!=data.size() || !file.commit()) fail("Could not atomically save the part: "+file.errorString());
}
Network loadPart(const QString& path) {
    QFile file(path);
    if(!file.open(QIODevice::ReadOnly)) fail(file.errorString());
    if(file.size()>32*1024*1024) fail("Part exceeds the 32 MB limit.");
    QJsonParseError e;
    auto doc=QJsonDocument::fromJson(file.readAll(),&e);
    if(e.error!=QJsonParseError::NoError || !doc.isObject()) fail("Invalid part JSON: "+e.errorString());
    return deserializePart(doc.object());
}
}
