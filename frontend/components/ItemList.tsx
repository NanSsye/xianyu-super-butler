import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Item, ItemSku, AccountDetail } from '../types';
import {
  createItem,
  deleteItem,
  getAccountDetails,
  getItems,
  getItemSkus,
  syncItemSkus,
  syncItemsFromAccount,
  updateItem,
  updateItemMultiQuantityDelivery,
  updateItemMultiSpec,
} from '../services/api';
import { Box, RefreshCw, ShoppingBag, Edit, Trash2, Plus, Save, X } from 'lucide-react';

type ItemRecord = Item & {
  multi_quantity_delivery?: number | boolean;
  is_multi_qty_ship?: number | boolean;
};

type AddItemForm = {
  cookie_id: string;
  item_id: string;
  item_title: string;
  item_price: string;
  item_image: string;
  is_multi_spec: boolean;
  is_multi_qty_ship: boolean;
};

type EditItemForm = {
  item_title: string;
  item_price: string;
  item_image: string;
};

const emptyAddForm: AddItemForm = {
  cookie_id: '',
  item_id: '',
  item_title: '',
  item_price: '',
  item_image: '',
  is_multi_spec: false,
  is_multi_qty_ship: false,
};

const getItemKey = (item: Item): string => `${item.cookie_id}-${item.item_id}`;

const hasFailedResponse = (response: unknown): response is { success: false; message?: string; detail?: string } => {
  if (!response || typeof response !== 'object' || !('success' in response)) return false;
  return (response as { success?: boolean }).success === false;
};

const responseMessage = (response: unknown, fallback: string): string => {
  if (response && typeof response === 'object') {
    const data = response as { message?: string; detail?: string; msg?: string };
    return data.message || data.detail || data.msg || fallback;
  }
  return fallback;
};

const ItemList: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemRecord | null>(null);
  const [editForm, setEditForm] = useState<EditItemForm>({
    item_title: '',
    item_price: '',
    item_image: '',
  });
  const [addForm, setAddForm] = useState<AddItemForm>(emptyAddForm);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [itemSkus, setItemSkus] = useState<Record<string, ItemSku[]>>({});

  const loadSkus = async (nextItems: Item[]): Promise<void> => {
    const entries = await Promise.all(nextItems.map(async (item) => {
      try {
        return [getItemKey(item), await getItemSkus(item.cookie_id, item.item_id)] as const;
      } catch {
        return [getItemKey(item), []] as const;
      }
    }));
    setItemSkus(Object.fromEntries(entries));
  };

  const loadItems = async (): Promise<Item[]> => {
    const nextItems = await getItems();
    setItems(nextItems);
    await loadSkus(nextItems);
    return nextItems;
  };

  useEffect(() => {
    let mounted = true;

    Promise.all([getAccountDetails(), getItems()])
      .then(([accountData, itemData]) => {
        if (!mounted) return;
        setAccounts(accountData);
        setItems(itemData);
        loadSkus(itemData);
      })
      .catch((error) => {
        console.error('加载商品信息失败:', error);
        if (mounted) alert('加载商品信息失败，请刷新重试');
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSync = async () => {
    if (!selectedAccount) {
      alert('请先选择账号');
      return;
    }

    setLoading(true);
    try {
      const response = await syncItemsFromAccount(selectedAccount);
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '同步失败'));
      }
      const nextItems = await loadItems();
      for (const item of nextItems.filter(item => item.cookie_id === selectedAccount)) {
        try {
          const skuResponse = await syncItemSkus(item.cookie_id, item.item_id);
          setItemSkus(previous => ({
            ...previous,
            [getItemKey(item)]: skuResponse.skus || [],
          }));
        } catch (skuError) {
          console.error(`同步商品 ${item.item_id} 规格失败:`, skuError);
        }
      }
    } catch (error) {
      console.error('同步商品失败:', error);
      alert(error instanceof Error ? error.message : '同步失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item: Item) => {
    const itemRecord = item as ItemRecord;
    setSelectedItem(itemRecord);
    setEditForm({
      item_title: itemRecord.item_title || '',
      item_price: itemRecord.item_price || '',
      item_image: itemRecord.item_image || '',
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    if (actionLoading === 'edit') return;
    setShowEditModal(false);
    setSelectedItem(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedItem) return;

    setActionLoading('edit');
    try {
      const response = await updateItem(selectedItem.cookie_id, selectedItem.item_id, {
        item_title: editForm.item_title.trim(),
        item_price: editForm.item_price.trim(),
        item_image: editForm.item_image.trim(),
      });
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '更新失败'));
      }
      await loadItems();
      setShowEditModal(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('更新商品失败:', error);
      alert(error instanceof Error ? error.message : '更新失败，请重试');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (item: Item) => {
    if (!confirm(`确认删除商品"${item.item_title || item.item_id}"吗？`)) return;

    const key = getItemKey(item);
    setActionLoading(`delete:${key}`);
    try {
      const response = await deleteItem(item.cookie_id, item.item_id);
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '删除失败'));
      }
      await loadItems();
    } catch (error) {
      console.error('删除商品失败:', error);
      alert(error instanceof Error ? error.message : '删除失败，请重试');
    } finally {
      setActionLoading(null);
    }
  };

  const openAddModal = () => {
    setAddForm({ ...emptyAddForm, cookie_id: selectedAccount });
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    if (actionLoading === 'add') return;
    setShowAddModal(false);
  };

  const handleAddItem = async () => {
    const cookieId = addForm.cookie_id.trim();
    const itemId = addForm.item_id.trim();
    if (!cookieId) {
      alert('请选择账号');
      return;
    }
    if (!itemId) {
      alert('请输入商品ID');
      return;
    }

    setActionLoading('add');
    try {
      const response = await createItem(cookieId, {
        item_id: itemId,
        item_title: addForm.item_title.trim(),
        item_price: addForm.item_price.trim(),
        item_image: addForm.item_image.trim(),
        is_multi_spec: addForm.is_multi_spec,
        multi_quantity_delivery: addForm.is_multi_qty_ship,
      });
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '添加失败'));
      }
      await loadItems();
      setShowAddModal(false);
      setAddForm({ ...emptyAddForm });
    } catch (error) {
      console.error('添加商品失败:', error);
      alert(error instanceof Error ? error.message : '添加失败，请重试');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleMultiSpec = async (item: Item) => {
    const itemRecord = item as ItemRecord;
    const key = getItemKey(item);
    const nextValue = !Boolean(itemRecord.is_multi_spec);
    setActionLoading(`multi-spec:${key}`);
    try {
      const response = await updateItemMultiSpec(item.cookie_id, item.item_id, nextValue);
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '切换多规格失败'));
      }
      await loadItems();
    } catch (error) {
      console.error('切换多规格失败:', error);
      alert(error instanceof Error ? error.message : '切换多规格失败，请重试');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleMultiQty = async (item: Item) => {
    const itemRecord = item as ItemRecord;
    const key = getItemKey(item);
    const currentValue = itemRecord.multi_quantity_delivery ?? itemRecord.is_multi_qty_ship;
    const nextValue = !Boolean(currentValue);
    setActionLoading(`multi-quantity:${key}`);
    try {
      const response = await updateItemMultiQuantityDelivery(item.cookie_id, item.item_id, nextValue);
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '切换多数量发货失败'));
      }
      await loadItems();
    } catch (error) {
      console.error('切换多数量发货失败:', error);
      alert(error instanceof Error ? error.message : '切换多数量发货失败，请重试');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSyncSkus = async (item: Item) => {
    const key = getItemKey(item);
    setActionLoading(`sync-skus:${key}`);
    try {
      const response = await syncItemSkus(item.cookie_id, item.item_id);
      if (hasFailedResponse(response)) {
        throw new Error(responseMessage(response, '同步规格失败'));
      }
      setItemSkus(previous => ({ ...previous, [key]: response.skus || [] }));
    } catch (error) {
      console.error('同步商品规格失败:', error);
      alert(error instanceof Error ? error.message : '同步规格失败，请重试');
    } finally {
      setActionLoading(null);
    }
  };

  const renderImage = (item: Item) => {
    const key = getItemKey(item);
    const imageKey = `${key}:${item.item_image || ''}`;
    const imageFailed = failedImages[imageKey];

    if (!item.item_image || imageFailed) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400" role="img" aria-label="图片加载失败">
          <Box className="w-10 h-10" />
          <span className="text-xs">图片加载失败</span>
        </div>
      );
    }

    return (
      <img
        src={item.item_image}
        alt={item.item_title || '商品图片'}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        onError={() => setFailedImages(previous => ({ ...previous, [imageKey]: true }))}
      />
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">商品管理</h2>
          <p className="text-gray-500 mt-2 text-sm">监控并管理所有账号下的闲鱼商品。</p>
        </div>
        <div className="flex gap-3">
          <select
            className="ios-input px-4 py-3 rounded-xl text-sm"
            value={selectedAccount}
            onChange={event => setSelectedAccount(event.target.value)}
            aria-label="选择账号以同步"
          >
            <option value="">选择账号以同步</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>{account.nickname}</option>
            ))}
          </select>
          <button
            onClick={handleSync}
            disabled={loading || !selectedAccount}
            className="ios-btn-primary flex items-center gap-2 px-6 py-3 rounded-2xl font-bold shadow-lg shadow-yellow-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            同步商品
          </button>
          <button
            onClick={openAddModal}
            className="px-5 py-3 rounded-2xl font-bold bg-gray-900 text-white hover:bg-gray-800 transition-colors flex items-center gap-2 shadow-lg"
          >
            <Plus className="w-4 h-4" />
            添加商品
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {items.map(item => {
          const itemRecord = item as ItemRecord;
          const key = getItemKey(item);
          const multiQuantityEnabled = Boolean(itemRecord.multi_quantity_delivery ?? itemRecord.is_multi_qty_ship);
          const deleteLoading = actionLoading === `delete:${key}`;
          const specLoading = actionLoading === `multi-spec:${key}`;
          const quantityLoading = actionLoading === `multi-quantity:${key}`;
          const skuLoading = actionLoading === `sync-skus:${key}`;
          const skus = itemSkus[key] || [];

          return (
            <div key={key} className="ios-card p-4 rounded-3xl hover:shadow-lg transition-all group relative">
              <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-auto">
                <button
                  onClick={() => handleEdit(item)}
                  disabled={actionLoading !== null}
                  className="p-2 bg-white/90 backdrop-blur rounded-lg shadow-md hover:bg-[#FFE815] transition-colors disabled:opacity-50"
                  title="编辑"
                  aria-label={`编辑商品 ${item.item_title || item.item_id}`}
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  disabled={actionLoading !== null}
                  className="p-2 bg-white/90 backdrop-blur rounded-lg shadow-md hover:bg-red-100 text-red-500 transition-colors disabled:opacity-50"
                  title="删除"
                  aria-label={`删除商品 ${item.item_title || item.item_id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="aspect-square bg-gray-100 rounded-2xl mb-4 overflow-hidden relative">
                {renderImage(item)}
                <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-lg pointer-events-none">
                  ¥{item.item_price || '-'}
                </div>
              </div>
              <h3 className="font-bold text-gray-900 line-clamp-2 text-sm mb-2 h-10">{item.item_title || '未命名商品'}</h3>
              <div className="flex justify-between items-center text-xs text-gray-500 mb-2">
                <span className="bg-gray-100 px-2 py-1 rounded-md truncate max-w-[100px]">ID: {item.item_id}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleMultiSpec(item)}
                  disabled={actionLoading !== null}
                  className={`flex-1 text-xs font-bold px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    itemRecord.is_multi_spec
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {specLoading ? '处理中…' : '多规格'}
                </button>
                <button
                  onClick={() => toggleMultiQty(item)}
                  disabled={actionLoading !== null}
                  className={`flex-1 text-xs font-bold px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    multiQuantityEnabled
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {quantityLoading ? '处理中…' : '多数量发货'}
                </button>
              </div>
              <button
                onClick={() => handleSyncSkus(item)}
                disabled={actionLoading !== null}
                className="mt-2 w-full rounded-lg bg-violet-100 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-200 disabled:opacity-50"
              >
                {skuLoading ? '正在读取闲鱼规格…' : `同步闲鱼规格${skus.length ? `（${skus.length}）` : ''}`}
              </button>
              {skus.length > 0 && (
                <details className="mt-2 rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-bold text-violet-800">查看规格、价格和闲鱼库存</summary>
                  <div className="mt-2 space-y-1.5">
                    {skus.map(sku => (
                      <div key={sku.sku_id} className="rounded-lg bg-white px-2 py-1.5 text-gray-700">
                        <div className="font-bold">{sku.display_name}</div>
                        <div>价格：{sku.price == null ? '未知' : `¥${sku.price.toFixed(2)}`} · 闲鱼库存：{sku.quantity ?? '未知'}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {deleteLoading && <span className="sr-only">删除中</span>}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="col-span-full py-20 text-center text-gray-400">
            <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-30" />
            暂无商品数据，请选择账号进行同步
          </div>
        )}
      </div>

      {showEditModal && selectedItem && createPortal(
        <div className="modal-overlay-centered" role="presentation">
          <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="edit-item-dialog-title">
            <div className="modal-header flex items-center justify-between">
              <h3 id="edit-item-dialog-title" className="text-2xl font-extrabold text-gray-900">编辑商品</h3>
              <button onClick={closeEditModal} disabled={actionLoading === 'edit'} className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50" aria-label="关闭编辑弹窗">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="edit-item-id">商品ID</label>
                <input id="edit-item-id" value={selectedItem.item_id} disabled className="w-full ios-input px-4 py-3 rounded-xl bg-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="edit-item-title-field">商品标题</label>
                <input
                  id="edit-item-title-field"
                  value={editForm.item_title}
                  onChange={event => setEditForm({ ...editForm, item_title: event.target.value })}
                  className="w-full ios-input px-4 py-3 rounded-xl"
                  placeholder="请输入商品标题"
                  disabled={actionLoading === 'edit'}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="edit-item-price">商品价格</label>
                  <input
                    id="edit-item-price"
                    value={editForm.item_price}
                    onChange={event => setEditForm({ ...editForm, item_price: event.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                    placeholder="例如 99.00"
                    disabled={actionLoading === 'edit'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="edit-item-image">图片 URL</label>
                  <input
                    id="edit-item-image"
                    value={editForm.item_image}
                    onChange={event => setEditForm({ ...editForm, item_image: event.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                    placeholder="可选"
                    disabled={actionLoading === 'edit'}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button onClick={closeEditModal} disabled={actionLoading === 'edit'} className="flex-1 px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50">取消</button>
                <button onClick={handleSaveEdit} disabled={actionLoading === 'edit'} className="flex-1 ios-btn-primary px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Save className="w-4 h-4" />
                  {actionLoading === 'edit' ? '保存中…' : '保存更改'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showAddModal && createPortal(
        <div className="modal-overlay-centered" role="presentation">
          <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="add-item-dialog-title">
            <div className="modal-header flex items-center justify-between">
              <h3 id="add-item-dialog-title" className="text-2xl font-extrabold text-gray-900">添加商品</h3>
              <button onClick={closeAddModal} disabled={actionLoading === 'add'} className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50" aria-label="关闭添加弹窗">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="add-item-account">所属账号</label>
                <select
                  id="add-item-account"
                  value={addForm.cookie_id}
                  onChange={event => setAddForm({ ...addForm, cookie_id: event.target.value })}
                  className="w-full ios-input px-4 py-3 rounded-xl"
                  disabled={actionLoading === 'add'}
                >
                  <option value="">请选择账号</option>
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.nickname || account.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="add-item-id">商品ID</label>
                <input id="add-item-id" value={addForm.item_id} onChange={event => setAddForm({ ...addForm, item_id: event.target.value })} className="w-full ios-input px-4 py-3 rounded-xl" placeholder="请输入商品ID" disabled={actionLoading === 'add'} />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="add-item-title-field">商品标题</label>
                <input id="add-item-title-field" value={addForm.item_title} onChange={event => setAddForm({ ...addForm, item_title: event.target.value })} className="w-full ios-input px-4 py-3 rounded-xl" placeholder="请输入商品标题" disabled={actionLoading === 'add'} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="add-item-price">商品价格</label>
                  <input id="add-item-price" value={addForm.item_price} onChange={event => setAddForm({ ...addForm, item_price: event.target.value })} className="w-full ios-input px-4 py-3 rounded-xl" placeholder="例如 99.00" disabled={actionLoading === 'add'} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="add-item-image">图片 URL</label>
                  <input id="add-item-image" value={addForm.item_image} onChange={event => setAddForm({ ...addForm, item_image: event.target.value })} className="w-full ios-input px-4 py-3 rounded-xl" placeholder="可选" disabled={actionLoading === 'add'} />
                </div>
              </div>
              <div className="flex gap-4 text-sm font-bold text-gray-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={addForm.is_multi_spec} onChange={event => setAddForm({ ...addForm, is_multi_spec: event.target.checked })} disabled={actionLoading === 'add'} />
                  多规格
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={addForm.is_multi_qty_ship} onChange={event => setAddForm({ ...addForm, is_multi_qty_ship: event.target.checked })} disabled={actionLoading === 'add'} />
                  多数量发货
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button onClick={closeAddModal} disabled={actionLoading === 'add'} className="flex-1 px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50">取消</button>
                <button onClick={handleAddItem} disabled={actionLoading === 'add'} className="flex-1 ios-btn-primary px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Plus className="w-4 h-4" />
                  {actionLoading === 'add' ? '添加中…' : '添加商品'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ItemList;
