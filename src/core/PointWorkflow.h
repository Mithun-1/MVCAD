#pragma once
#include "Network.h"
namespace mvcad {
struct ImportedPoint { QString id; Vec3 position; };
std::vector<ImportedPoint> parsePointsCsv(const QByteArray& data);
Network connectCenterlines(const std::vector<Curve>& curves,double tolerance=1e-6);
Network addCenterline(const Network& previous,const Curve& curve);
}
