#include "MainWindow.h"
#include "Viewport.h"
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QGroupBox>
#include <QInputDialog>
#include <QLabel>
#include <QMessageBox>
#include <QPushButton>
#include <QSettings>
#include <QStatusBar>
#include <QTreeWidget>
#include <QVBoxLayout>
using namespace mvcad;

void MainWindow::handleTreeSelection(){
    if(rebuilding_)return;auto* item=tree_->currentItem();if(!item)return;
    selectedPoints_.clear();for(auto* selected:tree_->selectedItems())if(selected->data(0,Qt::UserRole+2).isValid())selectedPoints_.push_back(selected->data(0,Qt::UserRole+2).toInt());
    if(item->data(0,Qt::UserRole+8).isValid())selectedPoints_=pointGroups_.value(item->data(0,Qt::UserRole+8).toString());
    viewport_->setSelectedPoints(selectedPoints_);selectedCurve_=-1;
    if(item->data(0,Qt::UserRole+6).isValid()){selectBody(item->data(0,Qt::UserRole+6).toString());return;}
    if(item->data(0,Qt::UserRole+5).isValid())selectedCurve_=item->data(0,Qt::UserRole+5).toInt();
    selectedBody_.clear();viewport_->clearGeometrySelection();
    if(item->data(0,Qt::UserRole).isValid()){selectBranch(item->data(0,Qt::UserRole).toInt());return;}
    selected_=-1;viewport_->setSelected(-1);parameters_->setEnabled(false);
}
void MainWindow::selectPoint(int i,bool toggle){
    if(!toggle)selectedPoints_.clear();auto it=std::find(selectedPoints_.begin(),selectedPoints_.end(),i);
    if(it==selectedPoints_.end())selectedPoints_.push_back(i);else selectedPoints_.erase(it);
    viewport_->setSelectedPoints(selectedPoints_);statusBar()->showMessage(QString("%1 points selected in click order. Choose Curve Through Points.").arg(selectedPoints_.size()));
}
void MainWindow::settings(){
    QDialog dialog(this);dialog.setWindowTitle("Settings");auto* layout=new QVBoxLayout(&dialog);auto* form=new QFormLayout;layout->addLayout(form);
    auto* precision=new QDoubleSpinBox;precision->setRange(1e-4,1);precision->setDecimals(4);precision->setSingleStep(.0001);precision->setValue(precision_);precision->setObjectName("displayPrecision");form->addRow("Display precision",precision);
    auto* label=new QLabel("Maximum display chord deviation. Default 0.001; finest 0.0001. Exact solid geometry is unchanged. Bodies rebuild in the background.");label->setWordWrap(true);layout->addWidget(label);
    auto* reset=new QPushButton("Restore default (0.001)");connect(reset,&QPushButton::clicked,&dialog,[=]{precision->setValue(.001);});layout->addWidget(reset);
    auto* buttons=new QDialogButtonBox(QDialogButtonBox::Ok|QDialogButtonBox::Cancel);layout->addWidget(buttons);connect(buttons,&QDialogButtonBox::accepted,&dialog,&QDialog::accept);connect(buttons,&QDialogButtonBox::rejected,&dialog,&QDialog::reject);
    if(dialog.exec()!=QDialog::Accepted||precision->value()==precision_)return;precision_=precision->value();QSettings().setValue("display/precision",precision_);rebuild();
}
void MainWindow::roundJunctions(){
    bool ok=false;const double radius=QInputDialog::getDouble(this,"Round Junctions","Junction round radius (0 uses automatic rounding):",document_.junctionRadius,0,1e6,6,&ok);if(!ok)return;
    auto next=document_;next.junctionRadius=radius;commit(next,"Round junctions");
}
void MainWindow::curveThroughPoints(){curveDialog();}
void MainWindow::assignAllDiameters(){
    if(document_.network.branches.empty())return;bool ok=false;const double diameter=QInputDialog::getDouble(this,"Assign Unassigned Branches","Diameter for all unassigned branches:",6,1e-9,1e9,9,&ok);if(!ok)return;
    auto next=document_.network;for(auto& branch:next.branches)if(branch.diameter==0)branch.diameter=diameter;commit(next,"Assign unassigned branches");
}
