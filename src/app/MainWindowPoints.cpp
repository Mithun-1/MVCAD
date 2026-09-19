#include "MainWindow.h"
#include "Viewport.h"
#include "core/DocumentEditing.h"
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPushButton>
#include <QSignalBlocker>
#include <QSplitter>
#include <QStatusBar>
#include <QTableWidget>
#include <QTabWidget>
#include <QVBoxLayout>
#include <QMap>
#include <QHash>
#include <QSet>
#include <QTimer>
#include <QApplication>
#include <QInputDialog>
#include <QTreeWidget>
#include <stdexcept>
#include <limits>
using namespace mvcad;
namespace {
QDoubleSpinBox* coordinate(double value=0){auto* field=new QDoubleSpinBox;field->setRange(-std::numeric_limits<double>::max(),std::numeric_limits<double>::max());field->setDecimals(9);field->setValue(value);field->setKeyboardTracking(false);return field;}
ImportedPoint& datum(Document& document,const QString& id){for(auto& point:document.points)if(point.id==id)return point;throw std::runtime_error("Datum reference no longer exists.");}
QString nextCurveId(const Document& document){int n=int(document.network.curves.size())+1;for(;;++n){auto name=QString("Centerline%1").arg(n);if(std::none_of(document.network.curves.begin(),document.network.curves.end(),[&](const auto& curve){return curve.id==name;}))return name;}}
}
void MainWindow::datumPoints(){
    auto working=document_;
    try{ensureCurveDefinitions(working);}catch(const std::exception& error){QMessageBox::warning(this,"Datum Points",error.what());return;}
    QDialog dialog(this);dialog.setWindowTitle("Datum Points — Coordinate System");dialog.setObjectName("datumPointsDialog");dialog.resize(660,490);auto* layout=new QVBoxLayout(&dialog);
    layout->addWidget(new QLabel("Reference: Part origin  ·  Cartesian coordinates"));
    auto* table=new QTableWidget(0,5);table->setObjectName("datumPointTable");table->setHorizontalHeaderLabels({"Point","X","Y","Z","Point set"});table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);table->setSelectionBehavior(QAbstractItemView::SelectRows);layout->addWidget(table,1);
    auto append=[&](const ImportedPoint& point,const QString& original){const int row=table->rowCount();table->insertRow(row);table->setItem(row,4,new QTableWidgetItem(point.setId));auto* id=new QTableWidgetItem(point.id);id->setData(Qt::UserRole,original);table->setItem(row,0,id);for(int c=0;c<3;++c)table->setItem(row,c+1,new QTableWidgetItem(QString::number(c==0?point.position.x:c==1?point.position.y:point.position.z,'g',17)));};
    table->setUpdatesEnabled(false);for(const auto& point:working.points)append(point,point.id);table->setUpdatesEnabled(true);
    if(!selectedPoints_.empty()&&selectedPoints_.front()<table->rowCount())table->selectRow(selectedPoints_.front());
    auto* row=new QHBoxLayout;layout->addLayout(row);auto* add=new QPushButton("Add Point");auto* remove=new QPushButton("Delete Point");row->addWidget(add);row->addWidget(remove);row->addStretch();
    auto* feedback=new QLabel("Editing a referenced datum rebuilds every dependent centerline. Changed branches require diameter reassignment.");feedback->setWordWrap(true);layout->addWidget(feedback);
    connect(add,&QPushButton::clicked,&dialog,[&]{QSet<QString> ids;for(int r=0;r<table->rowCount();++r)ids.insert(table->item(r,0)->text());int n=1;while(ids.contains(QString("PNT%1").arg(n)))++n;append({QString("PNT%1").arg(n),{},working.pointSets.empty()?QString{}:working.pointSets.back().id},{});table->setCurrentCell(table->rowCount()-1,1);table->editItem(table->currentItem());});
    connect(remove,&QPushButton::clicked,&dialog,[&]{int r=table->currentRow();if(r<0)return;const auto id=table->item(r,0)->data(Qt::UserRole).toString();for(const auto& curve:working.curveDefinitions)if(std::find(curve.pointIds.begin(),curve.pointIds.end(),id)!=curve.pointIds.end()){feedback->setText("Referenced by "+curve.id+". Remove that reference in Edit Definition before deleting the datum.");return;}table->removeRow(r);});
    auto candidate=[&]{auto next=working;next.points.clear();QMap<QString,QString> renamed;QHash<QString,bool> hidden;for(const auto& previous:working.points)hidden.insert(previous.id,previous.hidden);
        for(int r=0;r<table->rowCount();++r){ImportedPoint point;point.id=table->item(r,0)->text().trimmed();const auto old=table->item(r,0)->data(Qt::UserRole).toString();if(!old.isEmpty())renamed[old]=point.id;double values[3];for(int c=0;c<3;++c){bool ok=false;values[c]=table->item(r,c+1)->text().toDouble(&ok);if(!ok||!std::isfinite(values[c]))throw std::runtime_error("Every coordinate must be a finite number.");}point.position={values[0],values[1],values[2]};point.setId=table->item(r,4)->text().trimmed();point.hidden=hidden.value(old,false);next.points.push_back(point);}
        for(auto& curve:next.curveDefinitions)for(auto& id:curve.pointIds)if(renamed.contains(id))id=renamed[id];regenerateCenterlines(next);return next;};
    auto* buttons=new QDialogButtonBox(QDialogButtonBox::Ok|QDialogButtonBox::Cancel);auto* preview=buttons->addButton("Preview",QDialogButtonBox::ActionRole);layout->addWidget(buttons);
    connect(preview,&QPushButton::clicked,&dialog,[&]{try{auto next=candidate();viewport_->setDocument(next,{},precision_);viewport_->setCenterlines(true);feedback->setText("Preview ready. OK applies the datum and all dependent curve changes.");}catch(const std::exception& error){feedback->setText(error.what());}});
    connect(buttons,&QDialogButtonBox::accepted,&dialog,[&]{try{commit(candidate(),"Edit datum points");dialog.accept();}catch(const std::exception& error){feedback->setText(error.what());}});connect(buttons,&QDialogButtonBox::rejected,&dialog,&QDialog::reject);
    dialog.exec();viewport_->setDocument(document_,geometry_,precision_);viewport_->setSelectedPoints({});
}
void MainWindow::editCenterline(){
    if(selectedCurve_<0&&document_.network.curves.size()==1)selectedCurve_=0;
    if(selectedCurve_<0){statusBar()->showMessage("Select a centerline in the feature tree, then Edit Definition.",7000);return;}curveDialog(selectedCurve_);
}
void MainWindow::curveDialog(int edit){
    auto working=document_;try{ensureCurveDefinitions(working);}catch(const std::exception& error){QMessageBox::warning(this,"Curve Through Points",error.what());return;}
    if(edit>=0)for(const auto& d:working.curveDefinitions)if(d.id==document_.network.curves[edit].id&&!d.mirrorSource.isEmpty()){QMessageBox::information(this,"Mirrored centerline","This curve is driven by "+d.mirrorSource+" mirrored about "+d.mirrorAxis+". Edit its source points or axis to regenerate it.");return;}
    CurveDefinition definition;int definitionIndex=-1;
    if(edit>=0&&edit<int(document_.network.curves.size())){const auto id=document_.network.curves[edit].id;for(int i=0;i<int(working.curveDefinitions.size());++i)if(working.curveDefinitions[i].id==id){definition=working.curveDefinitions[i];definitionIndex=i;break;}}
    else{definition.id=nextCurveId(working);for(int index:selectedPoints_)if(index>=0&&index<int(working.points.size()))definition.pointIds.push_back(working.points[index].id);}
    QDialog dialog(this);dialog.setObjectName("curveDefinitionDialog");dialog.setWindowTitle(edit>=0?"Edit Definition — "+definition.id:"Curve Through Points");dialog.resize(710,560);auto* layout=new QVBoxLayout(&dialog);
    auto* heading=new QLabel("Curve Through Points  ·  Spline");heading->setStyleSheet("font-weight:600;padding:5px 0;");layout->addWidget(heading);
    auto* tabs=new QTabWidget;layout->addWidget(tabs,1);auto* placement=new QWidget;auto* placeLayout=new QVBoxLayout(placement);tabs->addTab(placement,"Placement");
    auto* split=new QHBoxLayout;placeLayout->addLayout(split,1);auto* left=new QVBoxLayout;split->addLayout(left,1);left->addWidget(new QLabel("Point references (in curve order)"));
    auto* ordered=new QListWidget;ordered->setObjectName("orderedCurvePoints");left->addWidget(ordered,1);
    auto* right=new QVBoxLayout;split->addLayout(right,1);right->addWidget(new QLabel("Selected point"));auto* form=new QFormLayout;right->addLayout(form);
    auto* collector=new QComboBox;collector->setObjectName("pointCollector");for(const auto& point:working.points)collector->addItem(point.id,point.id);form->addRow("Reference",collector);
    auto* x=coordinate();auto* y=coordinate();auto* z=coordinate();x->setObjectName("curvePointX");y->setObjectName("curvePointY");z->setObjectName("curvePointZ");form->addRow("X",x);form->addRow("Y",y);form->addRow("Z",z);
    auto* info=new QLabel("Coordinates edit the driving datum. Every curve that references this point will update.");info->setWordWrap(true);right->addWidget(info);right->addStretch();
    auto append=[&](const QString& id,int at=-1){auto* item=new QListWidgetItem(id);item->setData(Qt::UserRole,id);if(at<0)ordered->addItem(item);else ordered->insertItem(at,item);ordered->setCurrentItem(item);};
    auto select=[&]{auto* item=ordered->currentItem();if(!item)return;const auto id=item->data(Qt::UserRole).toString();const auto& point=datum(working,id);QSignalBlocker a(collector),b(x),c(y),d(z);collector->setCurrentIndex(collector->findData(id));x->setValue(point.position.x);y->setValue(point.position.y);z->setValue(point.position.z);};
    connect(ordered,&QListWidget::currentRowChanged,&dialog,[&]{select();});
    connect(collector,&QComboBox::currentIndexChanged,&dialog,[&]{if(auto* item=ordered->currentItem()){item->setData(Qt::UserRole,collector->currentData());item->setText(collector->currentText());select();}});
    connect(x,&QDoubleSpinBox::valueChanged,&dialog,[&](double value){if(auto* item=ordered->currentItem())datum(working,item->data(Qt::UserRole).toString()).position.x=value;});
    connect(y,&QDoubleSpinBox::valueChanged,&dialog,[&](double value){if(auto* item=ordered->currentItem())datum(working,item->data(Qt::UserRole).toString()).position.y=value;});
    connect(z,&QDoubleSpinBox::valueChanged,&dialog,[&](double value){if(auto* item=ordered->currentItem())datum(working,item->data(Qt::UserRole).toString()).position.z=value;});
    for(const auto& id:definition.pointIds)append(id);
    auto* operations=new QHBoxLayout;placeLayout->addLayout(operations);auto action=[&](const QString& title,auto callback){auto* button=new QPushButton(title);operations->addWidget(button);connect(button,&QPushButton::clicked,&dialog,callback);};
    action("Add Point",[&]{auto id=uniquePointId(working);Vec3 value{0,0,0};if(auto* item=ordered->currentItem())value=datum(working,item->data(Qt::UserRole).toString()).position+Vec3{1,0,0};working.points.push_back({id,value});{QSignalBlocker block(collector);collector->addItem(id,id);}append(id,ordered->currentRow()+1);x->setFocus();x->selectAll();});
    action("Insert Reference",[&]{if(working.points.empty())return;QDialog choose(&dialog);choose.setWindowTitle("Insert Datum Reference");auto* listLayout=new QVBoxLayout(&choose);auto* list=new QListWidget;for(const auto& point:working.points)list->addItem(point.id);listLayout->addWidget(list);auto* box=new QDialogButtonBox(QDialogButtonBox::Ok|QDialogButtonBox::Cancel);listLayout->addWidget(box);connect(box,&QDialogButtonBox::accepted,&choose,&QDialog::accept);connect(box,&QDialogButtonBox::rejected,&choose,&QDialog::reject);if(choose.exec()==QDialog::Accepted&&list->currentItem())append(list->currentItem()->text(),ordered->currentRow()+1);});
    action("Remove",[&]{delete ordered->takeItem(ordered->currentRow());});
    action("↑",[&]{int r=ordered->currentRow();if(r>0){auto* item=ordered->takeItem(r);ordered->insertItem(r-1,item);ordered->setCurrentItem(item);}});
    action("↓",[&]{int r=ordered->currentRow();if(r>=0&&r+1<ordered->count()){auto* item=ordered->takeItem(r);ordered->insertItem(r+1,item);ordered->setCurrentItem(item);}});
    auto* setChoice=new QComboBox;setChoice->addItem("All point sets",QString{});for(const auto& set:working.pointSets)setChoice->addItem(set.id,set.id);placeLayout->addWidget(setChoice);
    auto* all=new QPushButton("Use point set in list order");placeLayout->addWidget(all);connect(all,&QPushButton::clicked,&dialog,[&]{ordered->clear();for(const auto& point:working.points)if(setChoice->currentData().toString().isEmpty()||point.setId==setChoice->currentData().toString())append(point.id);});
    auto* close=new QCheckBox("Closed curve");close->setChecked(definition.closed);placeLayout->addWidget(close);
    auto* properties=new QWidget;auto* propertiesForm=new QFormLayout(properties);tabs->addTab(properties,"Properties");auto* name=new QLineEdit(definition.id);name->setObjectName("curveName");propertiesForm->addRow("Name",name);auto* tolerance=coordinate(working.network.tolerance);tolerance->setRange(1e-9,1);propertiesForm->addRow("Connection tolerance",tolerance);propertiesForm->addRow(new QLabel("Shared points and endpoint connections split selectable vessel branches."));
    auto* feedback=new QLabel("Preview regenerates connections. Changed branches are left unassigned.");feedback->setWordWrap(true);layout->addWidget(feedback);auto* buttons=new QDialogButtonBox(QDialogButtonBox::Ok|QDialogButtonBox::Cancel);auto* preview=buttons->addButton("Preview",QDialogButtonBox::ActionRole);layout->addWidget(buttons);
    auto candidate=[&]{auto next=working;auto curve=definition;curve.id=name->text().trimmed();curve.closed=close->isChecked();curve.pointIds.clear();for(int i=0;i<ordered->count();++i)curve.pointIds.push_back(ordered->item(i)->data(Qt::UserRole).toString());if(definitionIndex>=0){
        const auto oldId=next.curveDefinitions[definitionIndex].id;next.curveDefinitions[definitionIndex]=curve;
        for(auto& other:next.curveDefinitions){if(other.mirrorSource==oldId)other.mirrorSource=curve.id;if(other.mirrorAxis==oldId)other.mirrorAxis=curve.id;}
        for(auto& id:next.hiddenCurves)if(id==oldId)id=curve.id;
    }else next.curveDefinitions.push_back(curve);next.network.tolerance=tolerance->value();regenerateCenterlines(next);return next;};
    connect(preview,&QPushButton::clicked,&dialog,[&]{try{auto next=candidate();viewport_->setDocument(next,{},precision_,true);viewport_->setCenterlines(true);feedback->setText(QString("Preview: %1 branches. OK applies the definition.").arg(next.network.branches.size()));}catch(const std::exception& error){feedback->setText(error.what());}});
    connect(buttons,&QDialogButtonBox::accepted,&dialog,[&]{try{commit(candidate(),edit>=0?"Edit centerline definition":"Curve through points");dialog.accept();}catch(const std::exception& error){feedback->setText(error.what());}});connect(buttons,&QDialogButtonBox::rejected,&dialog,&QDialog::reject);
    const auto accepted=dialog.exec()==QDialog::Accepted;viewport_->setDocument(document_,geometry_,precision_,accepted);if(accepted){viewport_->setCenterlines(true);}selectedCurve_=-1;
}
bool MainWindow::dialogSmokeCheck(){
    auto original=document_;bool valid=true;Document seeded;seeded.points={{"P1",{0,0,0}},{"P2",{10,5,0}},{"P3",{20,0,0}}};commit(seeded,"Smoke: datum seed");
    QTimer watchdog;watchdog.setSingleShot(true);connect(&watchdog,&QTimer::timeout,this,[&]{valid=false;for(auto* dialog:findChildren<QDialog*>())dialog->reject();});
    const auto directory=qApp->property("mvcadVerificationDirectory").toString();
    QTimer::singleShot(100,this,[&]{auto* dialog=findChild<QDialog*>("datumPointsDialog");if(!dialog){valid=false;return;}auto* table=dialog->findChild<QTableWidget*>("datumPointTable");table->item(1,1)->setText("12");if(!directory.isEmpty())dialog->grab().save(directory+"/ui-datum-points.png");dialog->findChild<QDialogButtonBox*>()->button(QDialogButtonBox::Ok)->click();});
    watchdog.start(5000);datumPoints();watchdog.stop();if(!valid||document_.points[1].position.x!=12)return false;
    selectedPoints_={0,1,2};
    QTimer::singleShot(100,this,[&]{auto* dialog=findChild<QDialog*>("curveDefinitionDialog");if(!dialog){valid=false;return;}if(!directory.isEmpty())dialog->grab().save(directory+"/ui-curve-definition.png");dialog->findChild<QDialogButtonBox*>()->button(QDialogButtonBox::Ok)->click();});
    watchdog.start(5000);curveDialog();watchdog.stop();if(!valid||document_.curveDefinitions.size()!=1||document_.network.curves.size()!=1)return false;
    QTimer::singleShot(100,this,[&]{auto* dialog=findChild<QDialog*>("curveDefinitionDialog");if(!dialog){valid=false;return;}dialog->findChild<QDoubleSpinBox*>("curvePointX")->setValue(18);dialog->findChild<QDialogButtonBox*>()->button(QDialogButtonBox::Ok)->click();});
    watchdog.start(5000);curveDialog(0);watchdog.stop();if(!valid||document_.network.curves.front().points.back().x!=18)return false;
    // Cancelling coordinate edits must leave both datum and curve state intact.
    const auto before=serializeDocument(document_);
    QTimer::singleShot(100,this,[&]{auto* dialog=findChild<QDialog*>("curveDefinitionDialog");if(!dialog){valid=false;return;}dialog->findChild<QDoubleSpinBox*>("curvePointX")->setValue(15);dialog->reject();});
    watchdog.start(5000);curveDialog(0);watchdog.stop();if(!valid||serializeDocument(document_)!=before)return false;
    commit(original,"Smoke: restore model");return true;
}

void MainWindow::newPointSet(){
    bool ok=false;const auto name=QInputDialog::getText(this,"New Point Set","Set name",QLineEdit::Normal,QString("PointSet%1").arg(document_.pointSets.size()+1),&ok).trimmed();if(!ok)return;
    try{auto next=document_;appendPointSet(next,name,{});commit(next,"Create point set");datumPoints();}catch(const std::exception& e){QMessageBox::warning(this,"Point set unchanged",e.what());}
}
void MainWindow::entityVisibility(bool hidden){
    auto* item=tree_->currentItem();if(!item)return;auto next=document_;
    if(item->data(0,Qt::UserRole+2).isValid()){auto i=item->data(0,Qt::UserRole+2).toInt();next.points.at(i).hidden=hidden;}
    else if(item->data(0,Qt::UserRole+7).isValid()){auto id=item->data(0,Qt::UserRole+7).toString();for(auto& set:next.pointSets)if(set.id==id)set.hidden=hidden;}
    else if(item->data(0,Qt::UserRole+5).isValid()){auto id=next.network.curves.at(item->data(0,Qt::UserRole+5).toInt()).id;std::erase(next.hiddenCurves,id);if(hidden)next.hiddenCurves.push_back(id);}
    else if(item->data(0,Qt::UserRole+6).isValid()){selectedBody_=item->data(0,Qt::UserRole+6).toString();bodyVisibility(hidden);return;}else return;
    try{commit(next,hidden?"Hide reference geometry":"Show reference geometry");if(!hidden)viewport_->setCenterlines(true);}catch(const std::exception& e){QMessageBox::warning(this,"Visibility unchanged",e.what());}
}
void MainWindow::showAllGeometry(){auto next=document_;for(auto& p:next.points)p.hidden=false;for(auto& set:next.pointSets)set.hidden=false;next.hiddenCurves.clear();for(auto& body:next.bodyDisplay)body.hidden=false;commit(next,"Show all geometry");viewport_->setCenterlines(true);}
void MainWindow::mirrorCurve(){
    if(document_.network.curves.size()<2){QMessageBox::information(this,"Mirror Centerline","Create a source curve and a straight two-point axis in the XY plane first.");return;}
    QDialog dialog(this);dialog.setWindowTitle("Mirror Centerline");auto* layout=new QVBoxLayout(&dialog);auto* form=new QFormLayout;layout->addLayout(form);
    auto* source=new QComboBox;auto* axis=new QComboBox;for(const auto& c:document_.network.curves){source->addItem(c.id,c.id);if(c.points.size()==2)axis->addItem(c.id,c.id);}if(selectedCurve_>=0)source->setCurrentIndex(selectedCurve_);
    auto* name=new QLineEdit(nextCurveId(document_));form->addRow("Source curve",source);form->addRow("Central axis (XY)",axis);form->addRow("Mirror name",name);layout->addWidget(new QLabel("Reflect across the plane through the axis, parallel to Z. Source and axis remain editable."));
    auto* buttons=new QDialogButtonBox(QDialogButtonBox::Ok|QDialogButtonBox::Cancel);layout->addWidget(buttons);connect(buttons,&QDialogButtonBox::accepted,&dialog,&QDialog::accept);connect(buttons,&QDialogButtonBox::rejected,&dialog,&QDialog::reject);if(dialog.exec()!=QDialog::Accepted)return;
    try{auto next=document_;mirrorCenterline(next,source->currentData().toString(),axis->currentData().toString(),name->text().trimmed());commit(next,"Mirror centerline");viewport_->fitAll();}catch(const std::exception& e){QMessageBox::warning(this,"Mirror rejected",e.what());}
}
