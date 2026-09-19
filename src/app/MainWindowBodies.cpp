#include "MainWindow.h"
#include "Viewport.h"
#include "CadIcons.h"
#include <QAction>
#include <QCheckBox>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QLabel>
#include <QGroupBox>
#include <QListWidget>
#include <QMenu>
#include <QMessageBox>
#include <QPushButton>
#include <QSignalBlocker>
#include <QStatusBar>
#include <QTreeWidget>
#include <QVBoxLayout>
#include <QUndoStack>
#include <QUndoCommand>
#include <functional>
#include <stdexcept>
using namespace mvcad;
namespace {
BodyDisplay& appearance(std::vector<BodyDisplay>& states,const QString& id){for(auto& value:states)if(value.bodyId==id)return value;states.push_back({id,false,1});return states.back();}
class DisplayChange final:public QUndoCommand {
    std::vector<BodyDisplay> before_,after_;
    std::function<void(const std::vector<BodyDisplay>&)> apply_;
public:
    DisplayChange(std::vector<BodyDisplay> before,std::vector<BodyDisplay> after,
                  std::function<void(const std::vector<BodyDisplay>&)> apply,const QString& title)
      :QUndoCommand(title),before_(std::move(before)),after_(std::move(after)),apply_(std::move(apply)){}
    void undo()override{apply_(before_);}void redo()override{apply_(after_);}
};
}
void MainWindow::selectBody(const QString& id){selectedBody_=id;selected_=selectedCurve_=-1;viewport_->setSelected(-1);viewport_->setBodySelection(id);parameters_->setEnabled(false);
    QSignalBlocker block(tree_);tree_->clearSelection();QTreeWidgetItemIterator it(tree_);for(;*it;++it)if((*it)->data(0,Qt::UserRole+6).toString()==id){tree_->setCurrentItem(*it);break;}
}
void MainWindow::bodyMenu(const QPoint& point){auto* item=tree_->itemAt(point);if(!item)return;tree_->setCurrentItem(item);QMenu menu(this);
    if(item->data(0,Qt::UserRole+6).isValid()){
        selectedBody_=item->data(0,Qt::UserRole+6).toString();
        menu.addAction(cadIcon("hide"),"Hide body",this,[this]{bodyVisibility(true);});menu.addAction(cadIcon("eye"),"Show body",this,[this]{bodyVisibility(false);});
        menu.addAction("Toggle transparency",this,&MainWindow::bodyTransparency);menu.addSeparator();

        menu.addAction("Show dependencies",this,&MainWindow::showDependencies);
    }else if(selectedCurve_>=0){menu.addAction("Edit Definition…",this,&MainWindow::editCenterline);menu.addAction("Mirror about centerline…",this,&MainWindow::mirrorCurve);}

    else if(!selectedPoints_.empty())menu.addAction("Edit Datum Points…",this,&MainWindow::datumPoints);
    if(item->data(0,Qt::UserRole+2).isValid()||item->data(0,Qt::UserRole+5).isValid()||item->data(0,Qt::UserRole+7).isValid()){
        menu.addAction("Hide",this,[this]{entityVisibility(true);});menu.addAction("Show",this,[this]{entityVisibility(false);});
    }
    menu.addAction("Show all geometry",this,&MainWindow::showAllGeometry);
    menu.addSeparator();menu.addAction("Show all bodies",this,&MainWindow::showAllBodies);menu.exec(tree_->viewport()->mapToGlobal(point));
}
void MainWindow::commitBodyDisplay(const std::vector<BodyDisplay>& states,const QString& title){
    for(const auto& state:states)if(state.bodyId!="vessels"||!std::isfinite(state.opacity)||state.opacity<0||state.opacity>1)throw std::runtime_error("Invalid vessel appearance.");
    undo_->push(new DisplayChange(document_.bodyDisplay,states,[this](const auto& value){
        document_.bodyDisplay=value;viewport_->setBodyDisplay(value);QSignalBlocker block(tree_);
        for(QTreeWidgetItemIterator it(tree_);*it;++it)if((*it)->data(0,Qt::UserRole+6).isValid()){
            bool hidden=false;for(const auto& state:value)if(state.bodyId==(*it)->data(0,Qt::UserRole+6).toString())hidden=state.hidden;
            (*it)->setCheckState(0,hidden?Qt::Unchecked:Qt::Checked);
        }
        updateTitle();
    },title));
}
void MainWindow::bodyVisibility(bool hidden){if(selectedBody_.isEmpty()){statusBar()->showMessage("Select a body in Vessel Bodies or the viewport.",5000);return;}try{auto next=document_.bodyDisplay;appearance(next,selectedBody_).hidden=hidden;commitBodyDisplay(next,hidden?"Hide body":"Show body");viewport_->setBodySelection(selectedBody_);}catch(const std::exception& error){QMessageBox::warning(this,"Body display unchanged",error.what());}}
void MainWindow::bodyTransparency(){if(selectedBody_.isEmpty()){statusBar()->showMessage("Select a body first.",5000);return;}try{auto next=document_.bodyDisplay;auto& state=appearance(next,selectedBody_);state.opacity=state.opacity<1?1:.3;commitBodyDisplay(next,"Toggle body transparency");viewport_->setBodySelection(selectedBody_);}catch(const std::exception& error){QMessageBox::warning(this,"Body display unchanged",error.what());}}
void MainWindow::showAllBodies(){auto next=document_.bodyDisplay;for(auto& state:next)state.hidden=false;try{commitBodyDisplay(next,"Show all bodies");}catch(const std::exception& error){QMessageBox::warning(this,"Display unchanged",error.what());}}

void MainWindow::showDependencies(){
    if(auto* item=tree_->currentItem()){populateTreeItem(item);item->setExpanded(true);}
    QStringList lines;
    if(selectedCurve_>=0){const auto id=document_.network.curves[selectedCurve_].id;for(const auto& definition:document_.curveDefinitions)if(definition.id==id){lines<<definition.id;if(!definition.mirrorSource.isEmpty())lines<<"Source: "+definition.mirrorSource<<"Axis: "+definition.mirrorAxis;for(const auto& point:definition.pointIds)lines<<"Point: "+point;}}
    else if(!selectedBody_.isEmpty())lines<<"Vessel bodies depend on centerlines, assigned branch diameters, setbacks, and junction rounding.";
    else lines<<"Select a centerline or vessel body to inspect its dependencies.";
    QMessageBox::information(this,"Dependencies",lines.join('\n'));
}
