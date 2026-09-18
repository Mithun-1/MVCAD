#include "Network.h"
#include <QMap>
#include <QSet>
#include <QStringList>
#include <QStringDecoder>
#include <algorithm>
#include <array>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <tuple>

namespace mvcad {
static void fail(const QString& message) { throw std::runtime_error(message.toStdString()); }
std::vector<Curve> parseCsv(const QByteArray& data) {
    if (data.size()>16*1024*1024) fail("CSV exceeds the 16 MB import limit.");
    QStringDecoder decoder(QStringDecoder::Utf8);
    QString text=decoder.decode(data);
    if(decoder.hasError()) fail("CSV is not valid UTF-8.");
    if(text.startsWith(QChar(0xfeff))) text.remove(0,1);
    const auto lines=text.split('\n');
    bool header=false;
    int row=0;
    QMap<QString,int> indices;
    std::vector<Curve> curves;
    for(const auto& raw:lines) {
        ++row;
        auto line=raw.trimmed();
        if(line.isEmpty() || line.startsWith('#')) continue;
        const auto columns=line.split(',');
        if(!header) {
            QStringList names;
            for(const auto& c:columns) names<<c.trimmed().toLower();
            if(names!=QStringList{"curve_id","x","y","z"})
                fail("Expected CSV header: curve_id,x,y,z. Points are ordered by row within each curve.");
            header=true; continue;
        }
        if(columns.size()!=4) fail(QString("Row %1: expected four columns.").arg(row));
        auto id=columns[0].trimmed();
        if(id.isEmpty() || id.size()>128 || id.contains('"')) fail(QString("Row %1: invalid curve_id.").arg(row));
        Vec3 p;
        std::array<double*,3> coords{&p.x,&p.y,&p.z};
        for(int i=0;i<3;++i) {
            bool ok=false; *coords[i]=columns[i+1].trimmed().toDouble(&ok);
            if(!ok || !std::isfinite(*coords[i])) fail(QString("Row %1: coordinates must be finite numbers.").arg(row));
        }
        if(!indices.contains(id)) { indices[id]=static_cast<int>(curves.size()); curves.push_back({id,{}}); }
        curves[indices[id]].points.push_back(p);
    }
    if(curves.empty()) fail("The CSV contains no centerline points.");
    return curves;
}

Network buildNetwork(const std::vector<Curve>& curves, double tolerance) {
    if(!std::isfinite(tolerance) || tolerance<=0) fail("Connection tolerance must be positive and finite.");
    if(curves.empty()) fail("No curves to import.");
    Network n; n.curves=curves; n.tolerance=tolerance;
    using Cell=std::tuple<long long,long long,long long>;
    std::map<Cell,std::vector<int>> cells;
    std::vector<std::pair<int,int>> edges;
    std::set<std::pair<int,int>> uniqueEdges;
    QSet<QString> ids;
    size_t count=0;
    auto nodeFor=[&](Vec3 p) {
        if(!p.finite()) fail("Coordinates must be finite.");
        const double limit=static_cast<double>(std::numeric_limits<long long>::max()/4);
        if(std::max({std::abs(p.x/tolerance),std::abs(p.y/tolerance),std::abs(p.z/tolerance)})>limit)
            fail("Coordinate range is too large for the selected connection tolerance.");
        auto x=static_cast<long long>(std::floor(p.x/tolerance));
        auto y=static_cast<long long>(std::floor(p.y/tolerance));
        auto z=static_cast<long long>(std::floor(p.z/tolerance));
        int best=-1;
        for(int a=-1;a<=1;++a) for(int b=-1;b<=1;++b) for(int c=-1;c<=1;++c) {
            const auto it=cells.find({x+a,y+b,z+c});
            if(it!=cells.end()) for(int k:it->second) {
                const auto delta=n.nodes[k].point-p;
                if(delta.finite() && delta.length()<=tolerance && (best<0 || k<best)) best=k;
            }
        }
        if(best>=0) return best;
        const auto id=static_cast<int>(n.nodes.size());
        n.nodes.push_back({p,0}); cells[{x,y,z}].push_back(id); return id;
    };
    for(const auto& curve:curves) {
        if(curve.id.isEmpty() || ids.contains(curve.id)) fail("Curve identifiers must be nonempty and unique.");
        ids.insert(curve.id);
        if(curve.points.size()<2) fail("Each curve requires at least two points.");
        count+=curve.points.size();
        if(count>50000) fail("This development build supports at most 50,000 input points.");
        int last=-1;
        for(auto p:curve.points) {
            const int next=nodeFor(p);
            if(next==last) fail("Consecutive points coincide within connection tolerance; remove duplicates or reduce tolerance.");
            if(last>=0) {
                const auto delta=n.nodes[last].point-n.nodes[next].point;
                if(!delta.finite() || !std::isfinite(delta.length()))
                    fail("The distance between consecutive points is too large to represent safely.");
                auto edge=std::minmax(last,next);
                if(!uniqueEdges.insert(edge).second) fail("Duplicate/overlapping sampled edges were found. Import each connection once.");
                edges.emplace_back(last,next); ++n.nodes[last].degree; ++n.nodes[next].degree;
            }
            last=next;
        }
    }
    std::vector<std::vector<int>> adj(n.nodes.size());
    for(int e=0;e<static_cast<int>(edges.size());++e) { adj[edges[e].first].push_back(e); adj[edges[e].second].push_back(e); }
    auto other=[&](int e,int v){return edges[e].first==v?edges[e].second:edges[e].first;};
    std::vector<bool> seenNode(n.nodes.size()),seenEdge(edges.size());
    for(int v=0;v<static_cast<int>(n.nodes.size());++v) if(!seenNode[v]) {
        ++n.components; std::vector<int> todo{v}; seenNode[v]=true;
        while(!todo.empty()) { auto a=todo.back(); todo.pop_back(); for(int e:adj[a]) {int b=other(e,a); if(!seenNode[b]) {seenNode[b]=true;todo.push_back(b);} } }
    }
    auto walk=[&](int start,int edge) {
        Branch b; b.start=start; b.id=QString("B%1").arg(n.branches.size()+1,3,10,QChar('0')); b.points.push_back(n.nodes[start].point);
        int at=start;
        while(!seenEdge[edge]) {
            seenEdge[edge]=true; at=other(edge,at); b.points.push_back(n.nodes[at].point);
            if(n.nodes[at].degree!=2 || at==start) break;
            int next=-1; for(int e:adj[at]) if(!seenEdge[e]) {next=e;break;}
            if(next<0) break; edge=next;
        }
        b.end=at; n.branches.push_back(std::move(b));
    };
    for(int v=0;v<static_cast<int>(n.nodes.size());++v) if(n.nodes[v].degree!=2)
        for(int e:adj[v]) if(!seenEdge[e]) walk(v,e);
    for(int e=0;e<static_cast<int>(edges.size());++e) if(!seenEdge[e]) walk(edges[e].first,e);
    return n;
}

void setBranchParameters(Network& n,int index,double diameter,double start,double end) {
    if(index<0 || index>=static_cast<int>(n.branches.size())) fail("No branch selected.");
    if(!std::isfinite(diameter)||diameter<=0||diameter/2==0)
        fail("Diameter must be positive, finite, and large enough to represent a nonzero radius.");
    if(!std::isfinite(start)||!std::isfinite(end)||start<0||end<0||start>=1||end>=1)
        fail("Setbacks must be between 0% (inclusive) and 100% (exclusive).");
    auto& b=n.branches[index];
    const double a=n.nodes[b.start].degree>2?start:0;
    const double z=n.nodes[b.end].degree>2?end:0;
    if(a+z>=1) fail("Combined junction setbacks must leave some branch length to sweep.");
    b.diameter=diameter; b.startSetback=start; b.endSetback=end;
}
std::vector<JunctionState> junctionStates(const Network& n) {
    std::vector<JunctionState> result;
    for(int i=0;i<static_cast<int>(n.nodes.size());++i) if(n.nodes[i].degree>2) {
        JunctionState j{i,0,0};
        for(const auto& b:n.branches) { const int ends=(b.start==i?1:0)+(b.end==i?1:0); j.incident+=ends; if(b.diameter>0) j.assigned+=ends; }
        result.push_back(j);
    }
    return result;
}
Network demoNetwork() {
    auto n=buildNetwork({{"mother",{{-45,4,0},{-32,5,1},{-18,1,2},{0,0,0}}},
                         {"upper",{{0,0,0},{13,7,1},{25,19,2},{40,24,0}}},
                         {"lower",{{0,0,0},{12,-10,-2},{28,-19,-1},{43,-18,0}}},
                         {"upper2",{{40,24,0},{52,34,3},{64,34,2}}},
                         {"upper3",{{40,24,0},{54,19,-2},{66,16,-3}}}});
    const double sizes[]{8,6,0,4,4};
    for(int i=0;i<static_cast<int>(n.branches.size());++i) if(sizes[i]>0) setBranchParameters(n,i,sizes[i],.1,.1);
    return n;
}
} // namespace mvcad
