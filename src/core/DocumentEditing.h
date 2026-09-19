#pragma once

#include "Document.h"

namespace mvcad {

QString uniquePointId(const Document& document,const QString& prefix="PNT");
void ensureCurveDefinitions(Document& document);
void regenerateCenterlines(Document& document);
void mirrorCenterline(Document& document,const QString& source,const QString& axis,const QString& name);
void appendPointSet(Document& document,const QString& name,const std::vector<ImportedPoint>& points);
bool pointVisible(const Document&,const ImportedPoint&);
bool branchCurveVisible(const Document&,const Branch&);
std::vector<bool> branchCurveVisibility(const Document&);

} // namespace mvcad
