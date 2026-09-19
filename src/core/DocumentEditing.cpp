#include "DocumentEditing.h"
#include "cad/CadModel.h"

#include <QHash>
#include <QSet>
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <tuple>
#include <functional>

namespace mvcad {
namespace {

[[noreturn]] void fail(const QString& message){throw std::runtime_error(message.toStdString());}

bool exact(Vec3 a,Vec3 b){return a.x==b.x&&a.y==b.y&&a.z==b.z;}

void validatePoints(const Document& document,QSet<QString>& ids){
    if(document.points.size()>50000)fail("Document exceeds the supported imported-point limit.");
    for(const auto& point:document.points){
        if(point.id.isEmpty()||ids.contains(point.id))fail("Imported point identifiers must be nonempty and unique.");
        if(!point.position.finite())fail("Imported point coordinates must be finite.");
        ids.insert(point.id);
    }
}

void validateDefinitions(const Document& document,const QSet<QString>& pointIds){
    if(document.curveDefinitions.size()>1000)fail("Document exceeds the supported curve-definition limit.");
    QSet<QString> ids;size_t referenceCount=0;
    for(const auto& definition:document.curveDefinitions){
        if(definition.id.isEmpty()||ids.contains(definition.id))fail("Curve definition identifiers must be nonempty and unique.");
        if((definition.mirrorSource.isEmpty()&&definition.pointIds.size()<2)||definition.pointIds.size()>50000)fail("A curve definition requires at least two point references.");
        referenceCount+=definition.pointIds.size()+(definition.closed?1:0);
        if(referenceCount>50000)fail("Curve definitions exceed the supported point-reference limit.");
        ids.insert(definition.id);
        for(const auto& pointId:definition.pointIds)if(pointId.isEmpty()||!pointIds.contains(pointId))fail("Curve definition refers to a missing imported point.");
    }
}

using PointKey=std::tuple<double,double,double>;
using Cell=std::tuple<long long,long long,long long>;

PointKey pointKey(Vec3 point){return {point.x,point.y,point.z};}

class PointMatcher {
public:
    explicit PointMatcher(Document& document):document_(document){
        for(size_t index=0;index<document_.points.size();++index)add(index);
    }

    QString match(Vec3 position){
        if(const auto found=exact_.find(pointKey(position));found!=exact_.end())
            return document_.points[found->second].id;
        const auto [x,y,z]=cell(position);size_t best=document_.points.size();
        for(int a=-1;a<=1;++a)for(int b=-1;b<=1;++b)for(int c=-1;c<=1;++c){
            const auto found=cells_.find({x+a,y+b,z+c});if(found==cells_.end())continue;
            for(const auto index:found->second){
                const auto difference=document_.points[index].position-position;
                if(difference.finite()&&difference.length()<=document_.network.tolerance)best=std::min(best,index);
            }
        }
        if(best<document_.points.size())return document_.points[best].id;
        QString id;
        do{id=QString("PNT%1").arg(nextId_++,4,10,QChar('0'));}while(usedIds_.contains(id));
        const auto index=document_.points.size();document_.points.push_back({id,position});add(index);return id;
    }

private:
    Cell cell(Vec3 point)const{
        const double limit=static_cast<double>(std::numeric_limits<long long>::max()/4);
        if(std::max({std::abs(point.x/document_.network.tolerance),std::abs(point.y/document_.network.tolerance),std::abs(point.z/document_.network.tolerance)})>limit)
            fail("Coordinate range is too large for the selected connection tolerance.");
        return {static_cast<long long>(std::floor(point.x/document_.network.tolerance)),
                static_cast<long long>(std::floor(point.y/document_.network.tolerance)),
                static_cast<long long>(std::floor(point.z/document_.network.tolerance))};
    }

    void add(size_t index){
        const auto& point=document_.points[index];usedIds_.insert(point.id);
        exact_.try_emplace(pointKey(point.position),index);cells_[cell(point.position)].push_back(index);
    }

    Document& document_;
    QSet<QString> usedIds_;
    std::map<PointKey,size_t> exact_;
    std::map<Cell,std::vector<size_t>> cells_;
    int nextId_=1;
};

bool sameSequence(const Branch& branch,const Branch& old,bool reverse){
    if(branch.points.size()!=old.points.size())return false;
    for(size_t i=0;i<branch.points.size();++i){
        const auto oldIndex=reverse?old.points.size()-1-i:i;
        if(!exact(branch.points[i],old.points[oldIndex]))return false;
    }
    return true;
}

bool sameCurveSequence(const Curve& curve,const Curve& old,bool reverse){
    if(curve.points.size()!=old.points.size())return false;
    for(size_t i=0;i<curve.points.size();++i){
        const auto oldIndex=reverse?old.points.size()-1-i:i;
        if(!exact(curve.points[i],old.points[oldIndex]))return false;
    }
    return true;
}

using BranchKey=std::tuple<PointKey,PointKey,size_t>;
using EdgeKey=std::tuple<PointKey,PointKey>;

BranchKey branchKey(const Branch& branch){
    auto first=pointKey(branch.points.front()),last=pointKey(branch.points.back());
    if(last<first)std::swap(first,last);
    return {first,last,branch.points.size()};
}

EdgeKey edgeKey(Vec3 a,Vec3 b){
    auto first=pointKey(a),last=pointKey(b);if(last<first)std::swap(first,last);return {first,last};
}

} // namespace

QString uniquePointId(const Document& document,const QString& requestedPrefix){
    const auto prefix=requestedPrefix.isEmpty()?QString("PNT"):requestedPrefix;
    QSet<QString> used;for(const auto& point:document.points)used.insert(point.id);
    for(int index=1;index<std::numeric_limits<int>::max();++index){
        const auto candidate=QString("%1%2").arg(prefix).arg(index,4,10,QChar('0'));
        if(!used.contains(candidate))return candidate;
    }
    fail("Could not allocate a unique imported-point identifier.");
}

void ensureCurveDefinitions(Document& document){
    auto next=document;
    if(!std::isfinite(next.network.tolerance)||next.network.tolerance<=0)fail("Network tolerance must be positive and finite.");
    QSet<QString> pointIds;validatePoints(next,pointIds);
    if(!next.curveDefinitions.empty()){
        validateDefinitions(next,pointIds);document=std::move(next);return;
    }
    QSet<QString> curveIds;PointMatcher matcher(next);
    for(const auto& curve:next.network.curves){
        if(curve.id.isEmpty()||curveIds.contains(curve.id))fail("Legacy curve identifiers must be nonempty and unique.");
        if(curve.points.size()<2)fail("A legacy curve requires at least two points.");
        curveIds.insert(curve.id);for(const auto& point:curve.points)if(!point.finite())fail("Legacy curve coordinates must be finite.");
        const bool closed=curve.points.size()>2&&(curve.points.front()-curve.points.back()).length()<=next.network.tolerance;
        const auto count=curve.points.size()-(closed?1:0);CurveDefinition definition;definition.id=curve.id;definition.closed=closed;
        for(size_t i=0;i<count;++i)definition.pointIds.push_back(matcher.match(curve.points[i]));
        if(definition.pointIds.size()<2)fail("A promoted curve requires at least two distinct point references.");
        next.curveDefinitions.push_back(std::move(definition));
    }
    pointIds.clear();validatePoints(next,pointIds);validateDefinitions(next,pointIds);document=std::move(next);
}

void regenerateCenterlines(Document& document){
    auto next=document;ensureCurveDefinitions(next);
    QSet<QString> pointIds;validatePoints(next,pointIds);validateDefinitions(next,pointIds);
    if(!std::isfinite(next.network.tolerance)||next.network.tolerance<=0)fail("Network tolerance must be positive and finite.");

    QHash<QString,Vec3> positions;positions.reserve(static_cast<qsizetype>(next.points.size()));
    for(const auto& point:next.points)positions.insert(point.id,point.position);
    QHash<QString,Curve> generated;QSet<QString> visiting;
    std::function<Curve(const QString&)> generate=[&](const QString& id)->Curve{
        if(generated.contains(id))return generated[id];
        if(visiting.contains(id))fail("Cyclic centerline mirror dependency.");
        auto found=std::find_if(next.curveDefinitions.begin(),next.curveDefinitions.end(),[&](const auto& d){return d.id==id;});
        if(found==next.curveDefinitions.end())fail("Missing mirror source or axis.");
        const auto& definition=*found;visiting.insert(id);Curve curve;curve.id=id;
        if(!definition.mirrorSource.isEmpty()){
            const auto axis=generate(definition.mirrorAxis),source=generate(definition.mirrorSource);
            if(axis.points.size()!=2)fail("Mirror axis must be a straight two-point centerline.");
            const auto a=axis.points.front(),b=axis.points.back();auto direction=b-a;
            if(std::abs(direction.z)>next.network.tolerance||direction.length()<=next.network.tolerance)fail("Mirror axis must lie in the XY plane and have nonzero length.");
            direction=direction.normalized();
            for(auto p:source.points){auto delta=p-a;auto projection=direction*delta.dot(direction);auto q=a+projection*2-delta;q.z=p.z;curve.points.push_back(q);}
        }else{
        for(const auto& id:definition.pointIds){
            const auto point=positions.constFind(id);
            if(point==positions.cend())fail("Curve definition refers to a missing imported point.");
            curve.points.push_back(*point);
        }
        if(definition.closed&&!exact(curve.points.front(),curve.points.back()))curve.points.push_back(curve.points.front());
        }
        visiting.remove(id);generated.insert(id,curve);return curve;
    };
    std::vector<Curve> curves;curves.reserve(next.curveDefinitions.size());
    for(const auto& definition:next.curveDefinitions)curves.push_back(generate(definition.id));
    auto rebuilt=connectCenterlinesWithSplineConnections(curves,next.network.tolerance);

    std::set<EdgeKey> unchangedSourceEdges;
    for(const auto& curve:rebuilt.curves){
        int matches=0;
        for(const auto& old:document.network.curves)
            if(sameCurveSequence(curve,old,false)||sameCurveSequence(curve,old,true))++matches;
        if(matches!=1)continue;
        for(size_t i=1;i<curve.points.size();++i)
            unchangedSourceEdges.insert(edgeKey(curve.points[i-1],curve.points[i]));
    }

    std::map<BranchKey,std::vector<const Branch*>> oldByGeometry;
    for(const auto& old:document.network.branches){
        if(old.points.size()<2||!std::all_of(old.points.begin(),old.points.end(),[](Vec3 point){return point.finite();}))continue;
        oldByGeometry[branchKey(old)].push_back(&old);
    }
    for(auto& branch:rebuilt.branches){
        bool sourceUnchanged=true;
        for(size_t i=1;i<branch.points.size();++i)
            sourceUnchanged&=unchangedSourceEdges.contains(edgeKey(branch.points[i-1],branch.points[i]));
        if(!sourceUnchanged)continue;
        const auto found=oldByGeometry.find(branchKey(branch));
        if(found==oldByGeometry.end())continue;
        const Branch* match=nullptr;bool forward=false,reverse=false;
        for(const auto* old:found->second){
            const bool same=sameSequence(branch,*old,false),backward=sameSequence(branch,*old,true);
            if(!same&&!backward)continue;
            // Identical old sequences cannot be associated safely. Leave the
            // regenerated branch unassigned instead of choosing by index.
            if(match){match=nullptr;break;}
            match=old;forward=same;reverse=backward;
        }
        if(match){
            const auto& old=*match;
            branch.diameter=old.diameter;
            branch.startSetback=reverse&&!forward?old.endSetback:old.startSetback;
            branch.endSetback=reverse&&!forward?old.startSetback:old.endSetback;
        }
    }
    next.network=std::move(rebuilt);document=std::move(next);
}


void mirrorCenterline(Document& document,const QString& source,const QString& axis,const QString& name){
    auto next=document;ensureCurveDefinitions(next);CurveDefinition mirror;mirror.id=name;mirror.mirrorSource=source;mirror.mirrorAxis=axis;
    next.curveDefinitions.push_back(mirror);regenerateCenterlines(next);document=std::move(next);
}
void appendPointSet(Document& document,const QString& name,const std::vector<ImportedPoint>& points){
    if(name.trimmed().isEmpty())fail("Point set needs a name.");
    if(document.points.size()+points.size()>50000)fail("At most 50,000 points are supported.");
    auto next=document;for(const auto& set:next.pointSets)if(set.id==name)fail("Point set name already exists.");
    next.pointSets.push_back({name,false});QSet<QString> used;for(const auto& p:next.points)used.insert(p.id);
    for(auto p:points){auto original=p.id;int n=2;while(used.contains(p.id))p.id=original+QString("_%1").arg(n++);used.insert(p.id);p.setId=name;next.points.push_back(p);}
    (void)serializeDocument(next);document=std::move(next);
}
bool pointVisible(const Document& document,const ImportedPoint& point){
    if(point.hidden)return false;for(const auto& set:document.pointSets)if(set.id==point.setId)return !set.hidden;return true;
}
std::vector<bool> branchCurveVisibility(const Document& document){
    std::vector<bool> result(document.network.branches.size(),true);
    if(document.hiddenCurves.empty())return result;
    const QSet<QString> hidden(document.hiddenCurves.begin(),document.hiddenCurves.end());
    std::map<EdgeKey,int> owners;
    for(const auto& curve:document.network.curves){
        const int state=hidden.contains(curve.id)?1:2;
        for(size_t i=1;i<curve.points.size();++i)owners[edgeKey(curve.points[i-1],curve.points[i])]|=state;
    }
    for(size_t b=0;b<document.network.branches.size();++b){
        const auto& points=document.network.branches[b].points;int state=0;
        for(size_t i=1;i<points.size();++i){const auto found=owners.find(edgeKey(points[i-1],points[i]));if(found!=owners.end())state|=found->second;if(state&2)break;}
        result[b]=state==0||(state&2);
    }
    return result;
}
bool branchCurveVisible(const Document& document,const Branch& branch){
    if(document.hiddenCurves.empty())return true;
    // Network branches use the source curve's point-to-point edges. A branch
    // shared by several sources stays visible if any owning source is visible.
    bool owned=false;
    for(const auto& curve:document.network.curves){
        bool match=false;for(size_t i=1;i<curve.points.size()&&!match;++i)for(size_t j=1;j<branch.points.size();++j)
            if(edgeKey(curve.points[i-1],curve.points[i])==edgeKey(branch.points[j-1],branch.points[j])){match=true;break;}
        if(match){owned=true;if(std::find(document.hiddenCurves.begin(),document.hiddenCurves.end(),curve.id)==document.hiddenCurves.end())return true;}
    }
    return !owned;
}

} // namespace mvcad
