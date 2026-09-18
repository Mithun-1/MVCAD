#include "PointWorkflow.h"
#include <QStringDecoder>
#include <QStringList>
#include <QSet>
#include <algorithm>
#include <stdexcept>
namespace mvcad {
static void fail(const QString& message){throw std::runtime_error(message.toStdString());}
std::vector<ImportedPoint> parsePointsCsv(const QByteArray& data) {
    if(data.size()>16*1024*1024)fail("Point CSV exceeds 16 MB.");
    QStringDecoder decoder(QStringDecoder::Utf8);QString text=decoder.decode(data);
    if(decoder.hasError())fail("Point CSV must be UTF-8.");
    if(text.startsWith(QChar(0xfeff)))text.remove(0,1);
    bool header=false,hasId=false,legacy=false;int row=0;QSet<QString> ids;
    std::vector<ImportedPoint> result;
    for(auto line:text.split('\n')) {
        ++row;line=line.trimmed();if(line.isEmpty()||line.startsWith('#'))continue;
        auto cells=line.split(',');for(auto& cell:cells)cell=cell.trimmed();
        if(!header) {
            for(auto& cell:cells)cell=cell.toLower();
            hasId=cells==QStringList{"point_id","x","y","z"};
            legacy=cells==QStringList{"curve_id","x","y","z"};
            if(!hasId&&!legacy&&cells!=QStringList{"x","y","z"})fail("Expected x,y,z or point_id,x,y,z. Import creates points only.");
            header=true;continue;
        }
        const int offset=(hasId||legacy)?1:0;
        if(cells.size()!=3+offset)fail(QString("Row %1: incorrect number of columns.").arg(row));
        ImportedPoint p;p.id=hasId?cells[0]:QString("P%1").arg(result.size()+1,4,10,QChar('0'));
        if(p.id.isEmpty()||p.id.size()>128||ids.contains(p.id))fail("Point identifiers must be nonempty and unique.");
        double* coordinates[]{&p.position.x,&p.position.y,&p.position.z};
        for(int i=0;i<3;++i){bool ok;*coordinates[i]=cells[i+offset].toDouble(&ok);if(!ok||!std::isfinite(*coordinates[i]))fail(QString("Row %1: coordinates must be finite numbers.").arg(row));}
        ids.insert(p.id);result.push_back(p);if(result.size()>50000)fail("At most 50,000 points are supported.");
    }
    if(result.empty())fail("No points found in the CSV.");return result;
}
Network connectCenterlines(const std::vector<Curve>& curves,double tolerance) {
    if(curves.empty()){Network n;n.tolerance=tolerance;return n;}
    // Connect curve endpoints landing on an interior sampled span. Mere 3D
    // crossings do not connect. Insert explicit shared interpolation points.
    auto connected=curves;
    for(size_t i=0;i<curves.size();++i) {
        if(curves[i].points.size()<2)fail("A centerline requires at least two points.");
        for(auto endpoint:{curves[i].points.front(),curves[i].points.back()})
            for(size_t j=0;j<connected.size();++j)if(i!=j) {
                auto& points=connected[j].points;
                if(std::any_of(points.begin(),points.end(),[&](Vec3 p){return (p-endpoint).length()<=tolerance;}))continue;
                for(size_t k=1;k<points.size();++k) {
                    auto v=points[k]-points[k-1];const double length=v.length();if(!(length>tolerance))continue;
                    const auto direction=v/length;const double distance=(endpoint-points[k-1]).dot(direction);
                    if(distance<=tolerance||distance>=length-tolerance)continue;
                    if((points[k-1]+direction*distance-endpoint).length()<=tolerance){points.insert(points.begin()+static_cast<ptrdiff_t>(k),endpoint);break;}
                }
            }
    }
    return buildNetwork(connected,tolerance);
}
Network addCenterline(const Network& previous,const Curve& curve) {
    auto curves=previous.curves;curves.push_back(curve);auto next=connectCenterlines(curves,previous.tolerance);
    for(auto& branch:next.branches)for(const auto& old:previous.branches) {
        if(branch.points.size()!=old.points.size())continue;
        bool same=true,reverse=true;
        for(size_t i=0;i<branch.points.size();++i){same&=(branch.points[i]-old.points[i]).length()<=previous.tolerance;reverse&=(branch.points[i]-old.points[old.points.size()-1-i]).length()<=previous.tolerance;}
        if(same||reverse){branch.diameter=old.diameter;branch.startSetback=reverse&&!same?old.endSetback:old.startSetback;branch.endSetback=reverse&&!same?old.startSetback:old.endSetback;break;}
    }
    return next;
}
}
