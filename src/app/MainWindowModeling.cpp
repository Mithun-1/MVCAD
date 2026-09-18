#include "MainWindow.h"
#include "Viewport.h"
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QGroupBox>
#include <QLabel>
#include <QLineEdit>
#include <QInputDialog>
#include <QListWidget>
#include <QMessageBox>
#include <QPushButton>
#include <QSettings>
#include <QSignalBlocker>
#include <QStatusBar>
#include <QTabBar>
#include <QTableWidget>
#include <QTreeWidget>
#include <QUndoStack>
#include <QVBoxLayout>
#include <algorithm>
#include <stdexcept>
using namespace mvcad;
namespace {
QDoubleSpinBox* valueField(double value,double minimum=-1e9,double maximum=1e9){auto* field=new QDoubleSpinBox;field->setDecimals(9);field->setRange(minimum,maximum);field->setValue(value);field->setMinimumWidth(160);return field;}
QDialogButtonBox* buttons(QDialog& d,QVBoxLayout* layout){auto* b=new QDialogButtonBox(QDialogButtonBox::Ok|QDialogButtonBox::Cancel);QObject::connect(b,&QDialogButtonBox::accepted,&d,&QDialog::accept);QObject::connect(b,&QDialogButtonBox::rejected,&d,&QDialog::reject);layout->addWidget(b);return b;}
QString planeName(Plane p){return QStringList{"Front","Top","Right"}[int(p)];}
}
void MainWindow::handleTreeSelection(){
    if(rebuilding_)return;auto* item=tree_->currentItem();if(!item)return;
    selectedPoints_.clear();for(auto* selected:tree_->selectedItems())if(selected->data(0,Qt::UserRole+2).isValid())selectedPoints_.push_back(selected->data(0,Qt::UserRole+2).toInt());viewport_->setSelectedPoints(selectedPoints_);
    selectedSketch_=-1;selectedFeature_=-1;
    if(item->data(0,Qt::UserRole).isValid()){if(sketchMode_){sketchMode_=false;viewport_->editSketch(-1);}selectBranch(item->data(0,Qt::UserRole).toInt());return;}
    selected_=-1;viewport_->setSelected(-1);parameters_->setEnabled(false);
    if(item->data(0,Qt::UserRole+1).isValid())selectPlane(item->data(0,Qt::UserRole+1).toInt());
    if(item->data(0,Qt::UserRole+3).isValid())selectedSketch_=item->data(0,Qt::UserRole+3).toInt();
    if(item->data(0,Qt::UserRole+4).isValid())selectedFeature_=item->data(0,Qt::UserRole+4).toInt();
    if(sketchMode_){if(selectedSketch_>=0)viewport_->editSketch(selectedSketch_);else{sketchMode_=false;viewport_->editSketch(-1);}}
}
void MainWindow::selectPlane(int i){if(i<0||i>2)return;selectedPlane_=i;viewport_->selectPlane(i);statusBar()->showMessage(planeName(static_cast<Plane>(i))+" Plane selected. Choose New Sketch.",5000);}
void MainWindow::selectPoint(int i,bool toggle){if(!toggle)selectedPoints_.clear();auto it=std::find(selectedPoints_.begin(),selectedPoints_.end(),i);if(it==selectedPoints_.end())selectedPoints_.push_back(i);else selectedPoints_.erase(it);viewport_->setSelectedPoints(selectedPoints_);statusBar()->showMessage(QString("%1 points selected in click order. Curve Through Points creates the centerline.").arg(selectedPoints_.size()));}
void MainWindow::newSketch(){
    QDialog dialog(this);dialog.setWindowTitle("New Sketch");auto* layout=new QVBoxLayout(&dialog);auto* form=new QFormLayout;layout->addLayout(form);
    auto* plane=new QComboBox;plane->addItems({"Front Plane (XY)","Top Plane (XZ)","Right Plane (YZ)"});plane->setCurrentIndex(selectedPlane_);auto* offset=valueField(0);form->addRow("Reference plane",plane);form->addRow("Plane offset",offset);
    buttons(dialog,layout);if(dialog.exec()!=QDialog::Accepted)return;
    try{auto d=document_;Sketch sketch;sketch.id=QString("Sketch%1").arg(d.cad.sketches.size()+1);sketch.plane=static_cast<Plane>(plane->currentIndex());sketch.offset=offset->value();sketch.profile=ProfileType::Rectangle;d.cad.sketches.push_back(sketch);commit(d,"New "+sketch.id);selectedSketch_=int(d.cad.sketches.size())-1;editSketch();}
    catch(const std::exception& e){QMessageBox::warning(this,"Sketch failed",e.what());}
}
void MainWindow::editSketch(){
    if(selectedSketch_<0&&selectedFeature_>=0)selectedSketch_=document_.cad.features[selectedFeature_].sketch;
    if(selectedSketch_<0||selectedSketch_>=int(document_.cad.sketches.size())){statusBar()->showMessage("Select a sketch in the feature history, or choose New Sketch.",6000);return;}
    sketchMode_=true;viewport_->editSketch(selectedSketch_);tabs_->setCurrentIndex(1);statusBar()->showMessage("Choose Rectangle, Circle or Closed Polyline. Smart Dimension edits exact profile values.",10000);
}
void MainWindow::exitSketch(){sketchMode_=false;viewport_->editSketch(-1);tabs_->setCurrentIndex(0);viewport_->fitAll();}
void MainWindow::drawSketch(ProfileType type){if(!sketchMode_)editSketch();if(!sketchMode_)return;viewport_->setSketchTool(type);}
void MainWindow::acceptSketch(const Sketch& s){
    if(selectedSketch_<0)return;
    try{auto d=document_;d.cad.sketches[selectedSketch_]=s;commit(d,"Edit "+s.id);statusBar()->showMessage("Profile updated. Smart Dimension sets exact values; Exit Sketch returns to Features.",7000);}
    catch(const std::exception& e){QMessageBox::warning(this,"Sketch edit rejected",e.what());}
}
void MainWindow::dimensionSketch(){
    if(selectedSketch_<0&&selectedFeature_>=0)selectedSketch_=document_.cad.features[selectedFeature_].sketch;
    if(selectedSketch_<0){QMessageBox::information(this,"Dimensions","Select a sketch first.");return;}
    auto s=document_.cad.sketches[selectedSketch_];QDialog dialog(this);dialog.setWindowTitle("Profile Dimensions — "+s.id);auto* layout=new QVBoxLayout(&dialog);auto* form=new QFormLayout;layout->addLayout(form);
    auto* offset=valueField(s.offset);form->addRow(planeName(s.plane)+" plane offset",offset);
    auto* type=new QComboBox;type->addItems({"Circle","Rectangle","Closed polyline"});type->setCurrentIndex(int(s.profile));type->setEnabled(false);form->addRow("Profile",type);
    QPointF a=s.points.empty()?QPointF{}:s.points[0];auto* x=valueField(a.x());auto* y=valueField(a.y());QDoubleSpinBox *width=nullptr,*height=nullptr,*diameter=nullptr;QTableWidget* vertices=nullptr;
    if(s.profile!=ProfileType::Polyline){form->addRow(s.profile==ProfileType::Circle?"Center X":"Corner X",x);form->addRow(s.profile==ProfileType::Circle?"Center Y":"Corner Y",y);}
    if(s.profile==ProfileType::Circle){diameter=valueField(s.radius>0?s.radius*2:10,1e-6);form->addRow("Diameter",diameter);}
    else if(s.profile==ProfileType::Rectangle){auto b=s.points.size()>1?s.points[1]:a+QPointF(20,15);width=valueField(b.x()-a.x());height=valueField(b.y()-a.y());form->addRow("Width (signed)",width);form->addRow("Height (signed)",height);}
    else{vertices=new QTableWidget(int(s.points.size()),2);vertices->setHorizontalHeaderLabels({"X","Y"});for(int i=0;i<int(s.points.size());++i){vertices->setItem(i,0,new QTableWidgetItem(QString::number(s.points[i].x(),'g',17)));vertices->setItem(i,1,new QTableWidgetItem(QString::number(s.points[i].y(),'g',17)));}layout->addWidget(vertices);}
    auto* note=new QLabel("These values drive the profile directly. A general geometric constraint solver is not yet included.");note->setWordWrap(true);layout->addWidget(note);buttons(dialog,layout);
    if(dialog.exec()!=QDialog::Accepted)return;
    try{s.offset=offset->value();if(diameter){s.points={{x->value(),y->value()}};s.radius=diameter->value()/2;}else if(width){if(width->value()==0||height->value()==0)throw std::runtime_error("Rectangle dimensions cannot be zero.");s.points={{x->value(),y->value()},{x->value()+width->value(),y->value()+height->value()}};}else{for(int i=0;i<vertices->rowCount();++i){bool okx=false,oky=false;double vx=vertices->item(i,0)->text().toDouble(&okx),vy=vertices->item(i,1)->text().toDouble(&oky);if(!okx||!oky||!std::isfinite(vx)||!std::isfinite(vy))throw std::runtime_error("Vertices require finite coordinates.");s.points[i]={vx,vy};}}auto d=document_;d.cad.sketches[selectedSketch_]=s;commit(d,"Dimension "+s.id);if(sketchMode_)viewport_->editSketch(selectedSketch_);}
    catch(const std::exception& e){QMessageBox::warning(this,"Invalid dimensions",e.what());}
}
void MainWindow::extrude(bool cut,int edit){
    if(document_.cad.sketches.empty()){QMessageBox::information(this,"Sketch required","Select a reference plane and create a sketch first.");return;}
    if(cut&&document_.cad.features.empty()){QMessageBox::information(this,"Solid required","Create an extruded boss/base before an extruded cut.");return;}
    CadFeature f;if(edit>=0)f=document_.cad.features[edit];else{f.id=QString(cut?"Cut-Extrude%1":"Boss-Extrude%1").arg(document_.cad.features.size()+1);f.sketch=selectedSketch_>=0?selectedSketch_:int(document_.cad.sketches.size())-1;f.operation=cut?CadOperation::Cut:CadOperation::Boss;f.depth=10;}
    QDialog dialog(this);dialog.setObjectName("extrudeDialog");dialog.setWindowTitle(edit>=0?"Edit "+f.id:cut?"Extruded Cut":"Extruded Boss/Base");auto* layout=new QVBoxLayout(&dialog);auto* form=new QFormLayout;layout->addLayout(form);
    auto* sketch=new QComboBox;for(const auto& s:document_.cad.sketches)sketch->addItem(s.id+" · "+planeName(s.plane));sketch->setCurrentIndex(f.sketch);form->addRow("Profile sketch",sketch);
    auto* extent=new QComboBox;extent->addItem("Blind",int(CadExtent::Blind));extent->addItem("Mid Plane",int(CadExtent::MidPlane));if(cut)extent->addItem("Through All",int(CadExtent::ThroughAll));extent->setCurrentIndex(extent->findData(int(f.extent)));form->addRow("End condition",extent);
    auto* depth=valueField(f.depth,1e-6);depth->setObjectName("extrusionDepth");form->addRow("Depth",depth);auto* reverse=new QCheckBox("Reverse direction");reverse->setChecked(f.reversed);form->addRow(reverse);
    auto update=[=]{depth->setEnabled(extent->currentData().toInt()!=int(CadExtent::ThroughAll));reverse->setEnabled(extent->currentData().toInt()!=int(CadExtent::MidPlane));};connect(extent,&QComboBox::currentIndexChanged,&dialog,update);update();
    auto candidate=[&]{auto d=document_;f.sketch=sketch->currentIndex();f.extent=static_cast<CadExtent>(extent->currentData().toInt());f.depth=depth->value();f.reversed=reverse->isChecked();if(edit>=0)d.cad.features[edit]=f;else d.cad.features.push_back(f);return d;};
    auto* box=buttons(dialog,layout);auto* preview=box->addButton("Preview",QDialogButtonBox::ActionRole);connect(preview,&QPushButton::clicked,&dialog,[&]{try{auto d=candidate();viewport_->editSketch(-1);viewport_->setDocument(d,buildCad(d.cad,precision_),precision_,true);viewport_->setPlanesVisible(false);}catch(const std::exception& e){QMessageBox::warning(&dialog,"Cannot build feature",e.what());}});
    const bool accepted=dialog.exec()==QDialog::Accepted;
    viewport_->setDocument(document_,buildCad(document_.cad,precision_),precision_);
    if(!accepted){if(sketchMode_)viewport_->editSketch(selectedSketch_);return;}
    try{auto d=candidate();commit(d,edit>=0?"Edit "+f.id:"Create "+f.id);selectedFeature_=edit>=0?edit:int(d.cad.features.size())-1;sketchMode_=false;viewport_->editSketch(-1);viewport_->setPlanesVisible(false);viewport_->fitAll();tabs_->setCurrentIndex(0);statusBar()->showMessage("Valid CAD solid rebuilt. Double-click its feature to edit parameters.",7000);}
    catch(const std::exception& e){QMessageBox::warning(this,"Feature rejected — previous solid retained",e.what());if(sketchMode_)viewport_->editSketch(selectedSketch_);}
}
void MainWindow::editFeature(){if(selectedFeature_<0||selectedFeature_>=int(document_.cad.features.size())){statusBar()->showMessage("Select a solid feature in the history.",5000);return;}extrude(document_.cad.features[selectedFeature_].operation==CadOperation::Cut,selectedFeature_);}
void MainWindow::deleteLastFeature(){if(document_.cad.features.empty())return;auto d=document_;d.cad.features.pop_back();selectedFeature_=-1;try{commit(d,"Remove last feature");}catch(const std::exception& e){QMessageBox::warning(this,"Cannot remove feature",e.what());}}
void MainWindow::settings(){
    QDialog dialog(this);dialog.setWindowTitle("Settings");auto* layout=new QVBoxLayout(&dialog);auto* form=new QFormLayout;layout->addLayout(form);auto* precision=valueField(precision_,1e-4,1);precision->setDecimals(4);precision->setSingleStep(.0001);precision->setObjectName("displayPrecision");form->addRow("Display precision",precision);
    auto* label=new QLabel("Maximum circular chord deviation, in dimensionless coordinates. Default: 0.001. Finest: 0.0001. Smaller values produce smoother display meshes; exact CAD geometry is unchanged.");label->setWordWrap(true);layout->addWidget(label);auto* reset=new QPushButton("Restore default (0.001)");connect(reset,&QPushButton::clicked,&dialog,[=]{precision->setValue(.001);});layout->addWidget(reset);buttons(dialog,layout);dialog.resize(420,230);if(dialog.exec()!=QDialog::Accepted)return;
    try{auto cad=buildCad(document_.cad,precision->value());auto vessels=buildVessels(document_.network,precision->value(),document_.junctionRadius);precision_=precision->value();QSettings().setValue("display/precision",precision_);viewport_->setDocument(document_,cad,precision_,false,&vessels);statusBar()->showMessage("Display precision saved.",4000);}catch(const std::exception& e){QMessageBox::warning(this,"Precision unchanged",e.what());}
}
void MainWindow::roundJunctions(){
    if(document_.network.branches.empty()){QMessageBox::information(this,"Junction rounding","Create connected centerlines and assign their diameters first.");return;}
    bool ok=false;double radius=QInputDialog::getDouble(this,"Round Junctions","Radius applied to fully assigned junction intersection edges (0 disables rounding):",document_.junctionRadius,0,1e6,6,&ok);if(!ok)return;
    try{auto d=document_;d.junctionRadius=radius;commit(d,"Round junctions");statusBar()->showMessage("Junction rounding updated.",5000);}catch(const std::exception& e){QMessageBox::warning(this,"Rounding rejected — previous geometry retained",e.what());}
}
void MainWindow::curveThroughPoints(){
    if(document_.points.size()<2){QMessageBox::information(this,"Import points first","Import a CSV containing x,y,z or point_id,x,y,z, then select points to construct a centerline.");return;}
    QDialog dialog(this);dialog.setWindowTitle("Curve Through Points");dialog.resize(680,510);auto* layout=new QVBoxLayout(&dialog);auto* name=new QLineEdit(QString("Centerline%1").arg(document_.network.curves.size()+1));auto* form=new QFormLayout;form->addRow("Centerline name",name);auto* tolerance=valueField(document_.network.tolerance,1e-9,1);form->addRow("Connection tolerance",tolerance);layout->addLayout(form);
    auto* info=new QLabel("Add points in curve order. Reuse shared points to connect vessels. An endpoint on another centerline creates a junction and splits branches automatically. New connections regenerate the affected curve.");info->setWordWrap(true);layout->addWidget(info);
    auto* row=new QHBoxLayout;layout->addLayout(row);auto* available=new QListWidget;available->setSelectionMode(QAbstractItemView::ExtendedSelection);auto* ordered=new QListWidget;ordered->setObjectName("orderedCurvePoints");row->addWidget(available);row->addWidget(ordered);
    auto label=[&](int i){const auto& p=document_.points[i];return QString("%1  (%2, %3, %4)").arg(p.id).arg(p.position.x).arg(p.position.y).arg(p.position.z);};
    for(int i=0;i<int(document_.points.size());++i){auto* item=new QListWidgetItem(label(i),available);item->setData(Qt::UserRole,i);}
    auto append=[&](int i){for(int r=0;r<ordered->count();++r)if(ordered->item(r)->data(Qt::UserRole).toInt()==i)return;auto* item=new QListWidgetItem(label(i),ordered);item->setData(Qt::UserRole,i);};for(int i:selectedPoints_)if(i<int(document_.points.size()))append(i);
    auto* actions=new QHBoxLayout;layout->addLayout(actions);auto action=[&](QString text,auto callback){auto* b=new QPushButton(text);actions->addWidget(b);connect(b,&QPushButton::clicked,&dialog,callback);};
    action("Add selected →",[&]{for(auto* item:available->selectedItems())append(item->data(Qt::UserRole).toInt());});action("All in file order",[&]{ordered->clear();for(int i=0;i<int(document_.points.size());++i)append(i);});action("Remove",[&]{delete ordered->takeItem(ordered->currentRow());});
    action("Up",[&]{int i=ordered->currentRow();if(i>0){auto* item=ordered->takeItem(i);ordered->insertItem(i-1,item);ordered->setCurrentRow(i-1);}});action("Down",[&]{int i=ordered->currentRow();if(i>=0&&i+1<ordered->count()){auto* item=ordered->takeItem(i);ordered->insertItem(i+1,item);ordered->setCurrentRow(i+1);}});
    auto* close=new QCheckBox("Close this centerline (last point connects to first)");layout->addWidget(close);buttons(dialog,layout);if(dialog.exec()!=QDialog::Accepted)return;
    try{Curve curve{name->text().trimmed(),{}};for(int i=0;i<ordered->count();++i)curve.points.push_back(document_.points[ordered->item(i)->data(Qt::UserRole).toInt()].position);if(curve.points.size()<2)throw std::runtime_error("Select at least two ordered points.");if(close->isChecked())curve.points.push_back(curve.points.front());auto d=document_;d.network.tolerance=tolerance->value();d.network=addCenterlineWithSplineConnections(d.network,curve);commit(d,"Curve through points: "+curve.id);viewport_->setPlanesVisible(false);viewport_->fitAll();statusBar()->showMessage(QString("Centerline created: %1 selectable branches at confirmed connections. Assign each branch diameter in Auto Sweep.").arg(d.network.branches.size()),12000);}
    catch(const std::exception& e){QMessageBox::warning(this,"Curve not created",e.what());}
}
